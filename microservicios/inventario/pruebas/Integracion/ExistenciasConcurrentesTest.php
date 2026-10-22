<?php

declare(strict_types=1);

namespace Pruebas\Integracion;

use Pruebas\Soporte\PruebaConMongoDB;
use Clb\Inventario\Dominio\Existencias;
use Clb\Inventario\Puertos\Entrada\PuertoGestionarExistencias;

final class ExistenciasConcurrentesTest extends PruebaConMongoDB
{
    private function preparada(): array
    {
        $producto = $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true])->assertCreated()->json('producto.identificador');
        $casos = app(PuertoGestionarExistencias::class);
        $ids = [];
        foreach (['A', 'B'] as $sku) {
            $id = Existencias::uuid(); $ids[] = $id;
            $casos->ejecutar('CREAR_VARIANTE', ['identificador_producto' => $producto, 'identificador' => $id, 'sku' => $sku, 'talla' => 'M', 'color' => 'Negro', 'activo' => true], Existencias::uuid());
            $casos->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $id, 'tipo' => 'ENTRADA', 'cantidad' => 10, 'motivo' => 'Recepción', 'versión_esperada' => 1], Existencias::uuid());
        }
        return [$casos, $ids];
    }
    private function dos(string $tipo, array $uno, array $otro, ?string $clave = null, ?string $tipoOtro = null): array
    {
        $procesos = []; $esperar = microtime(true) + 3;
        foreach ([$uno, $otro] as $índice => $datos) {
            $proceso = proc_open([PHP_BINARY, dirname(__DIR__).'/Soporte/ejecutar-existencias-concurrentes.php'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $tuberías, dirname(__DIR__, 2));
            self::assertIsResource($proceso);
            fwrite($tuberías[0], json_encode(['colección' => $this->colección->getCollectionName(), 'tipo' => $índice === 1 ? ($tipoOtro ?? $tipo) : $tipo, 'datos' => $datos, 'clave' => $clave ?? Existencias::uuid(), 'esperar_hasta' => $esperar], JSON_UNESCAPED_UNICODE)); fclose($tuberías[0]);
            $procesos[] = [$proceso, $tuberías];
        }
        $resultados = [];
        foreach ($procesos as [$proceso, $tuberías]) {
            $salida = stream_get_contents($tuberías[1]); $errores = stream_get_contents($tuberías[2]); fclose($tuberías[1]); fclose($tuberías[2]);
            self::assertSame(0, proc_close($proceso), $errores);
            $resultados[] = json_decode($salida, true, flags: JSON_THROW_ON_ERROR);
        }
        return $resultados;
    }
    public function test_dos_salidas_no_consumen_el_mismo_stock(): void
    {
        [$casos, [$a]] = $this->preparada();
        $datos = ['identificador_variante' => $a, 'tipo' => 'SALIDA', 'cantidad' => 7, 'motivo' => 'Salida concurrente', 'versión_esperada' => 2];
        $resultados = $this->dos('REGISTRAR_MOVIMIENTO', $datos, $datos);
        $estados = array_column($resultados, 'estado'); sort($estados);
        self::assertSame([200, 409], $estados);
        self::assertSame(3, $casos->consultar('VARIANTE', $a)['variante']['física']);
        self::assertCount(2, $casos->consultar('MOVIMIENTOS', $a, true)['movimientos']);
    }
    public function test_dos_reservas_multiples_son_todo_o_nada(): void
    {
        [$casos, [$a, $b]] = $this->preparada();
        $datos = ['identificador' => Existencias::uuid(), 'identificador_pedido' => 'externo', 'líneas' => [['identificador_variante' => $a, 'cantidad' => 7, 'versión_esperada' => 2], ['identificador_variante' => $b, 'cantidad' => 7, 'versión_esperada' => 2]]];
        $otro = [...$datos, 'identificador' => Existencias::uuid()];
        $estados = array_column($this->dos('RESERVAR', $datos, $otro), 'estado'); sort($estados);
        self::assertSame([200, 409], $estados);
        foreach ([$a, $b] as $id) self::assertSame(7, $casos->consultar('VARIANTE', $id)['variante']['reservada']);
    }
    public function test_reintentos_concurrentes_misma_clave_un_solo_movimiento(): void
    {
        [$casos, [$a]] = $this->preparada();
        $datos = ['identificador_variante' => $a, 'tipo' => 'SALIDA', 'cantidad' => 3, 'motivo' => 'Misma solicitud', 'versión_esperada' => 2];
        [$uno, $otro] = $this->dos('REGISTRAR_MOVIMIENTO', $datos, $datos, Existencias::uuid());
        self::assertSame($uno, $otro);
        self::assertSame(7, $casos->consultar('VARIANTE', $a)['variante']['física']);
        self::assertCount(2, $casos->consultar('MOVIMIENTOS', $a, true)['movimientos']);
    }
    public function test_consumo_concurrente_idempotente_y_compensacion_incompatible(): void
    {
        [$casos, [$a]] = $this->preparada();
        $id = Existencias::uuid();
        $casos->ejecutar('RESERVAR', ['identificador' => $id, 'identificador_pedido' => 'pedido', 'líneas' => [['identificador_variante' => $a, 'cantidad' => 3, 'versión_esperada' => 2]]], Existencias::uuid());
        [$uno, $otro] = $this->dos('CONSUMIR_RESERVA', ['identificador_reserva' => $id], ['identificador_reserva' => $id], Existencias::uuid());
        self::assertSame($uno, $otro);
        self::assertSame(7, $casos->consultar('VARIANTE', $a)['variante']['física']);
    }
    public function test_indices_de_sku_y_clave_compartida_existen(): void
    {
        $this->preparada();
        $nombres = array_map(fn ($índice) => $índice->getName(), iterator_to_array($this->colección->listIndexes()));
        self::assertContains('clb_sku_variante_unico', $nombres);
        self::assertContains('clb_operacion_unica', $nombres);
    }
    public function test_sku_repetido_concurrente_solo_crea_una_variante(): void
    {
        $producto = $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true])->assertCreated()->json('producto.identificador');
        $datos = ['identificador_producto' => $producto, 'identificador' => Existencias::uuid(), 'sku' => 'CLB-MISMO-SKU', 'talla' => 'M', 'color' => 'Negro', 'activo' => true];
        $estados = array_column($this->dos('CREAR_VARIANTE', $datos, [...$datos, 'identificador' => Existencias::uuid()]), 'estado'); sort($estados);
        self::assertSame([200, 409], $estados);
        self::assertCount(1, app(PuertoGestionarExistencias::class)->consultar('VARIANTES', $producto)['variantes']);
    }
    public function test_consumir_y_liberar_en_carrera_tienen_un_solo_resultado_terminal(): void
    {
        [$casos, [$a]] = $this->preparada(); $id = Existencias::uuid();
        $casos->ejecutar('RESERVAR', ['identificador' => $id, 'identificador_pedido' => 'pedido', 'líneas' => [['identificador_variante' => $a, 'cantidad' => 3, 'versión_esperada' => 2]]], Existencias::uuid());
        $datos = ['identificador_reserva' => $id];
        $estados = array_column($this->dos('CONSUMIR_RESERVA', $datos, $datos, tipoOtro: 'LIBERAR_RESERVA'), 'estado'); sort($estados);
        self::assertSame([200, 409], $estados);
        $reserva = $casos->consultar('RESERVA', $id)['reserva']; $variante = $casos->consultar('VARIANTE', $a)['variante'];
        self::assertSame(0, $variante['reservada']);
        self::assertSame($reserva['estado'] === 'CONSUMIDA' ? 7 : 10, $variante['física']);
    }
}
