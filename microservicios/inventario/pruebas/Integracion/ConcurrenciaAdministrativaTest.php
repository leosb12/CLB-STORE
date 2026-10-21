<?php

declare(strict_types=1);

namespace Pruebas\Integracion;

use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Pruebas\Soporte\PruebaConMongoDB;

final class ConcurrenciaAdministrativaTest extends PruebaConMongoDB
{
    private function ejecutarDos(string $tipo, array $uno, array $otro): array
    {
        $nombre = $this->colección->getCollectionName();
        $procesos = [];
        $esperar = microtime(true) + 3;
        foreach ([$uno, $otro] as $datos) {
            $proceso = proc_open([PHP_BINARY, dirname(__DIR__).'/Soporte/ejecutar-operacion-concurrente.php'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $tuberías, dirname(__DIR__, 2));
            self::assertIsResource($proceso);
            fwrite($tuberías[0], json_encode(['colección' => $nombre, 'tipo' => $tipo, 'datos' => $datos, 'esperar_hasta' => $esperar], JSON_UNESCAPED_UNICODE));
            fclose($tuberías[0]);
            $procesos[] = [$proceso, $tuberías];
        }
        $resultados = [];
        foreach ($procesos as [$proceso, $tuberías]) {
            $salida = stream_get_contents($tuberías[1]); $errores = stream_get_contents($tuberías[2]);
            fclose($tuberías[1]); fclose($tuberías[2]);
            self::assertSame(0, proc_close($proceso), $errores);
            $resultados[] = json_decode($salida, true, flags: JSON_THROW_ON_ERROR);
        }
        return $resultados;
    }

    #[Test]
    public function dosProcesosRegistranLaMismaClaveUnaSolaVez(): void
    {
        $datos = ['CLB-CONCURRENTE', 'Camisa concurrente', 'Diseño', 'Camisas', '0.29', true, Str::uuid()->toString()];
        [$uno, $otro] = $this->ejecutarDos('registrar', $datos, $datos);
        self::assertSame($uno, $otro);
        self::assertSame(1, $this->colección->countDocuments());
    }

    #[Test]
    public function dosProcesosModificanConClavesDistintasSinPerderUnaActualizacion(): void
    {
        $producto = $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true])->assertCreated()->json('producto');
        $datos = [$producto['identificador'], $producto['sku'], 'Propuesta uno', '', 'Camisas', '129.90', true, 1, Str::uuid()->toString()];
        $otros = $datos; $otros[2] = 'Propuesta dos'; $otros[8] = Str::uuid()->toString();
        $resultados = $this->ejecutarDos('modificar', $datos, $otros);
        $estados = array_column($resultados, 'estado'); sort($estados);
        self::assertSame([200, 409], $estados);
        self::assertSame(2, $this->colección->findOne(['_id' => $producto['identificador']])['versión_sincronización']);
    }

    #[Test]
    public function dosProcesosReintentanLaMismaEdicionSinIncrementarDosVeces(): void
    {
        $producto = $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true])->assertCreated()->json('producto');
        $datos = [$producto['identificador'], $producto['sku'], 'Edición idempotente', '', 'Camisas', '129.90', false, 1, Str::uuid()->toString()];
        [$uno, $otro] = $this->ejecutarDos('modificar', $datos, $datos);
        self::assertSame($uno, $otro);
        self::assertSame(2, $this->colección->findOne(['_id' => $producto['identificador']])['versión_sincronización']);
    }
}
