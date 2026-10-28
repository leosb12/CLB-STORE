<?php

declare(strict_types=1);

namespace Pruebas\Integracion;

use Pruebas\Soporte\PruebaConMongoDB;
use Clb\Inventario\Dominio\Existencias;
use Clb\Inventario\Puertos\Entrada\PuertoGestionarExistencias;

/** Prueba operacional local: reinicia únicamente MongoDB del proyecto, sin borrar su volumen. */
final class PersistenciaExistenciasTrasReinicioTest extends PruebaConMongoDB
{
    public function test_movimientos_reservas_claves_y_eventos_sobreviven_reinicio_real(): void
    {
        $producto = $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true])->assertCreated()->json('producto.identificador');
        $casos = app(PuertoGestionarExistencias::class); $id = Existencias::uuid();
        $casos->ejecutar('CREAR_VARIANTE', ['identificador_producto' => $producto, 'identificador' => $id, 'sku' => 'CLB-REINICIO', 'talla' => 'M', 'color' => 'Negro', 'activo' => true], Existencias::uuid());
        $casos->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $id, 'tipo' => 'ENTRADA', 'cantidad' => 12, 'motivo' => 'Recepción antes del reinicio', 'versión_esperada' => 1], Existencias::uuid());
        $casos->ejecutar('CONFIGURAR_MINIMO', ['identificador_variante' => $id, 'mínimo' => 10, 'versión_esperada' => 2], Existencias::uuid());
        $reservaId = Existencias::uuid(); $clave = Existencias::uuid();
        $datos = ['identificador' => $reservaId, 'identificador_pedido' => 'pedido-externo', 'líneas' => [['identificador_variante' => $id, 'cantidad' => 3]]];
        $reserva = $casos->ejecutar('RESERVAR', $datos, $clave);
        $antes = json_encode($this->colección->findOne(['_id' => 'clb_existencias']), JSON_THROW_ON_ERROR);
        $proceso = proc_open(['docker', 'restart', 'clb_mongo'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $tuberías);
        self::assertIsResource($proceso);
        $salida = stream_get_contents($tuberías[1]); $error = stream_get_contents($tuberías[2]); fclose($tuberías[1]); fclose($tuberías[2]);
        self::assertSame(0, proc_close($proceso), $error); self::assertStringContainsString('clb_mongo', $salida);
        $conectado = false;
        for ($intento = 0; $intento < 100; $intento++) {
            try { $this->colección->countDocuments(); $conectado = true; break; }
            catch (\MongoDB\Driver\Exception\Exception) { usleep(200000); }
        }
        self::assertTrue($conectado, 'MongoDB debe volver a aceptar conexiones.');
        self::assertSame($antes, json_encode($this->colección->findOne(['_id' => 'clb_existencias']), JSON_THROW_ON_ERROR));
        self::assertSame($reserva, $casos->ejecutar('RESERVAR', $datos, $clave));
        self::assertCount(1, $casos->consultar('EVENTOS')['eventos']);
        $claveConsumo = Existencias::uuid();
        $consumo = $casos->ejecutar('CONSUMIR_RESERVA', ['identificador_reserva' => $reservaId], $claveConsumo);
        self::assertSame($consumo, $casos->ejecutar('CONSUMIR_RESERVA', ['identificador_reserva' => $reservaId], $claveConsumo));
        self::assertSame(9, $casos->consultar('VARIANTE', $id)['variante']['física']);
        self::assertCount(2, $casos->consultar('MOVIMIENTOS', $id, true)['movimientos']);
    }
}
