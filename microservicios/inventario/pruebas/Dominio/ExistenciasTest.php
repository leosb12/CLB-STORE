<?php

declare(strict_types=1);

namespace Pruebas\Dominio;

use Clb\Inventario\Dominio\{Existencias, ErrorDeExistencias, SkuDuplicado};
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

final class ExistenciasTest extends TestCase
{
    private function preparada(int $cantidad = 10): array
    {
        $dominio = new Existencias;
        $id = Existencias::uuid();
        $dominio->ejecutar('CREAR_VARIANTE', ['identificador' => $id, 'identificador_producto' => str_repeat('a', 32), 'sku' => 'CLB-M-NEGRO', 'talla' => 'M', 'color' => 'Negro', 'activo' => true], Existencias::uuid(), '2026-10-21T12:00:00.000Z');
        $dominio->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $id, 'tipo' => 'ENTRADA', 'cantidad' => $cantidad, 'motivo' => 'Recepción verificada', 'versión_esperada' => 1], Existencias::uuid(), '2026-10-21T12:01:00.000Z');
        return [$dominio, $id];
    }
    public function test_creacion_con_sku_normalizado_y_disponibilidad(): void
    {
        [$dominio, $id] = $this->preparada();
        self::assertSame(10, $dominio->pública($id)['disponible']);
        self::assertCount(1, $dominio->variante($id)['movimientos']);
        self::assertSame(0, $dominio->pública($id)['reservada']);
    }
    public static function cantidadesInvalidas(): array { return [[-1], [0], [1.5], ['2'], [true], [1000000001]]; }
    #[DataProvider('cantidadesInvalidas')]
    public function test_cantidades_estrictas(mixed $cantidad): void
    {
        [$dominio, $id] = $this->preparada();
        $this->expectException(ErrorDeExistencias::class);
        $dominio->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $id, 'tipo' => 'ENTRADA', 'cantidad' => $cantidad, 'motivo' => 'Verificación', 'versión_esperada' => 2], Existencias::uuid(), 'fecha');
    }
    public function test_no_stock_negativo_ni_mutacion_parcial(): void
    {
        [$dominio, $id] = $this->preparada();
        try {
            $dominio->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $id, 'tipo' => 'SALIDA', 'cantidad' => 11, 'motivo' => 'Salida', 'versión_esperada' => 2], Existencias::uuid(), 'fecha');
            self::fail('Debió rechazar la salida.');
        } catch (ErrorDeExistencias) { self::assertSame(10, $dominio->pública($id)['física']); }
    }
    public function test_ajuste_explicito_y_cruce_de_umbral_sin_duplicar(): void
    {
        [$dominio, $id] = $this->preparada();
        $dominio->ejecutar('CONFIGURAR_MINIMO', ['identificador_variante' => $id, 'mínimo' => 5, 'versión_esperada' => 2], Existencias::uuid(), 'fecha');
        foreach ([[5, 3], [1, 4]] as [$cantidad, $versión]) $dominio->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $id, 'tipo' => 'AJUSTE', 'sentido' => 'DISMINUCION', 'cantidad' => $cantidad, 'motivo' => 'Recuento físico', 'versión_esperada' => $versión], Existencias::uuid(), 'fecha');
        self::assertSame(4, $dominio->pública($id)['disponible']);
        self::assertCount(1, $dominio->eventos);
        self::assertSame('stock_bajo', $dominio->eventos[0]['tipo']);
    }
    public function test_sku_unico_global(): void
    {
        [$dominio] = $this->preparada();
        $this->expectException(SkuDuplicado::class);
        $dominio->ejecutar('CREAR_VARIANTE', ['identificador' => Existencias::uuid(), 'identificador_producto' => 'otro', 'sku' => 'clb-m-negro', 'talla' => 'L', 'color' => 'Blanco', 'activo' => true], Existencias::uuid(), 'fecha');
    }
    public function test_reserva_liberacion_y_consumo_sin_doble_descuento(): void
    {
        [$dominio, $id] = $this->preparada();
        $reserva = Existencias::uuid();
        $dominio->ejecutar('RESERVAR', ['identificador' => $reserva, 'identificador_pedido' => 'pedido-externo', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 4]]], Existencias::uuid(), 'fecha');
        self::assertSame(6, $dominio->pública($id)['disponible']);
        foreach ([1, 2] as $_) $dominio->ejecutar('CONSUMIR_RESERVA', ['identificador_reserva' => $reserva], Existencias::uuid(), 'fecha');
        self::assertSame(6, $dominio->pública($id)['física']);
        self::assertSame(0, $dominio->pública($id)['reservada']);
        self::assertCount(2, $dominio->variante($id)['movimientos']);
        $this->expectException(ErrorDeExistencias::class);
        $dominio->ejecutar('LIBERAR_RESERVA', ['identificador_reserva' => $reserva], Existencias::uuid(), 'fecha');
    }
    public function test_variante_importada_sin_contador_conserva_limite_y_puede_reservarse(): void
    {
        [$dominio, $id] = $this->preparada();
        unset($dominio->variantes[$id]['operaciones']);
        $reserva = Existencias::uuid();
        $dominio->ejecutar('RESERVAR', ['identificador' => $reserva, 'identificador_pedido' => 'pedido', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 1]]], Existencias::uuid(), 'fecha');
        self::assertSame(3, $dominio->variante($id)['operaciones']);
        self::assertSame(9, $dominio->pública($id)['disponible']);
        $dominio->ejecutar('CONSUMIR_RESERVA', ['identificador_reserva' => $reserva], Existencias::uuid(), 'fecha');
        self::assertSame(4, $dominio->variante($id)['operaciones']);
        self::assertSame(9, $dominio->pública($id)['física']);
    }
    public function test_reserva_sin_version_tolera_movimientos_ajenos_sin_sobrevender(): void
    {
        [$dominio, $id] = $this->preparada();
        // Otro cliente movió la variante: con versión obligatoria esta compra legítima fallaría.
        $dominio->ejecutar('RESERVAR', ['identificador' => Existencias::uuid(), 'identificador_pedido' => 'pedido-a', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 6]]], Existencias::uuid(), 'fecha');
        $dominio->ejecutar('RESERVAR', ['identificador' => Existencias::uuid(), 'identificador_pedido' => 'pedido-b', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 4]]], Existencias::uuid(), 'fecha');
        self::assertSame(0, $dominio->pública($id)['disponible']);
        try {
            $dominio->ejecutar('RESERVAR', ['identificador' => Existencias::uuid(), 'identificador_pedido' => 'pedido-c', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 1]]], Existencias::uuid(), 'fecha');
            self::fail('No debe reservar más de lo disponible.');
        } catch (ErrorDeExistencias $error) { self::assertSame(409, $error->estado); }
    }
    public function test_reserva_rechaza_version_porque_no_forma_parte_del_contrato(): void
    {
        [$dominio, $id] = $this->preparada();
        try {
            // Hay stock de sobra: el rechazo solo puede deberse al campo no admitido.
            $dominio->ejecutar('RESERVAR', ['identificador' => Existencias::uuid(), 'identificador_pedido' => 'pedido', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 1, 'versión_esperada' => 2]]], Existencias::uuid(), 'fecha');
            self::fail('Debe rechazar la versión en una línea de reserva.');
        } catch (ErrorDeExistencias $error) {
            self::assertSame(422, $error->estado);
            self::assertSame('Línea de reserva inválida.', $error->getMessage());
            self::assertSame(10, $dominio->pública($id)['disponible']);
        }
    }
    public function test_identidad_no_cambia_con_historial(): void
    {
        [$dominio, $id] = $this->preparada();
        $this->expectException(ErrorDeExistencias::class);
        $dominio->ejecutar('MODIFICAR_VARIANTE', ['identificador_variante' => $id, 'sku' => 'OTRO', 'talla' => 'L', 'color' => 'Blanco', 'activo' => true, 'versión_esperada' => 2], Existencias::uuid(), 'fecha');
    }
    public function test_reserva_multiple_fallida_no_reserva_ninguna_linea(): void
    {
        [$dominio, $id] = $this->preparada();
        try {
            $dominio->ejecutar('RESERVAR', ['identificador' => Existencias::uuid(), 'identificador_pedido' => 'pedido', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 2], ['identificador_variante' => Existencias::uuid(), 'cantidad' => 2]]], Existencias::uuid(), 'fecha');
            self::fail('Debió rechazar la reserva.');
        } catch (ErrorDeExistencias) { self::assertSame(0, $dominio->pública($id)['reservada']); }
    }
    public static function identidadesInvalidas(): array { return [['talla', ''], ['color', '  '], ['talla', 42], ['color', str_repeat('a', 81)], ['activo', 1], ['identificador', 'sin-uuid']]; }
    #[DataProvider('identidadesInvalidas')]
    public function test_identidad_validada_en_el_dominio(string $campo, mixed $valor): void
    {
        $datos = ['identificador' => Existencias::uuid(), 'identificador_producto' => 'producto', 'sku' => 'CLB-M', 'talla' => 'M', 'color' => 'Negro', 'activo' => true];
        $this->expectException(ErrorDeExistencias::class);
        (new Existencias)->ejecutar('CREAR_VARIANTE', [...$datos, $campo => $valor], Existencias::uuid(), 'fecha');
    }
    public function test_limite_conserva_espacio_para_compensar_reservas(): void
    {
        [$dominio, $id] = $this->preparada();
        for ($versión = 2; $versión < 254; $versión++) $dominio->ejecutar('CONFIGURAR_MINIMO', ['identificador_variante' => $id, 'mínimo' => 0, 'versión_esperada' => $versión], Existencias::uuid(), 'fecha');
        $reserva = Existencias::uuid();
        $dominio->ejecutar('RESERVAR', ['identificador' => $reserva, 'identificador_pedido' => 'pedido', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 1]]], Existencias::uuid(), 'fecha');
        try {
            $dominio->ejecutar('CONFIGURAR_MINIMO', ['identificador_variante' => $id, 'mínimo' => 0, 'versión_esperada' => 255], Existencias::uuid(), 'fecha');
            self::fail('Debe reservar espacio para la compensación.');
        } catch (ErrorDeExistencias) {
            $dominio->ejecutar('LIBERAR_RESERVA', ['identificador_reserva' => $reserva], Existencias::uuid(), 'fecha');
            self::assertSame(0, $dominio->pública($id)['reservada']); self::assertSame(256, $dominio->variante($id)['operaciones']);
        }
    }
}
