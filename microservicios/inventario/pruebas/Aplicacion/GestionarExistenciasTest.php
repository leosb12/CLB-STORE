<?php

declare(strict_types=1);

namespace Pruebas\Aplicacion;

use Clb\Inventario\Aplicacion\{GestionarExistencias, RegistrarProducto, DatosRegistroProducto};
use Clb\Inventario\Dominio\{Existencias, ConflictoDeIdempotencia, ErrorDeExistencias};
use PHPUnit\Framework\TestCase;
use Pruebas\Soporte\{RepositorioExistenciasEnMemoria, RepositorioProductosEnMemoria};

final class GestionarExistenciasTest extends TestCase
{
    private function preparar(): array
    {
        $productos = new RepositorioProductosEnMemoria;
        $producto = (new RegistrarProducto($productos))->ejecutar(new DatosRegistroProducto('CLB-P', 'Camiseta', '', 'Camisetas', '0.29'));
        $repositorio = new RepositorioExistenciasEnMemoria;
        $casos = new GestionarExistencias($repositorio, $productos);
        $datos = ['identificador_producto' => $producto->identificador, 'identificador' => Existencias::uuid(), 'sku' => 'CLB-M', 'talla' => 'M', 'color' => 'Negro', 'activo' => true];
        return [$casos, $repositorio, $datos];
    }
    public function test_creacion_y_repeticion_sin_laravel_ni_mongodb(): void
    {
        [$casos, $repositorio, $datos] = $this->preparar(); $clave = Existencias::uuid();
        $uno = $casos->ejecutar('CREAR_VARIANTE', $datos, $clave); $otro = $casos->ejecutar('CREAR_VARIANTE', $datos, $clave);
        self::assertSame($uno, $otro); self::assertSame(1, $repositorio->revisión);
        self::assertCount(1, $repositorio->existencias->variantes);
    }
    public function test_misma_clave_otro_contenido_es_conflicto(): void
    {
        [$casos, , $datos] = $this->preparar(); $clave = Existencias::uuid();
        $casos->ejecutar('CREAR_VARIANTE', $datos, $clave);
        $this->expectException(ConflictoDeIdempotencia::class);
        $casos->ejecutar('CREAR_VARIANTE', [...$datos, 'talla' => 'L'], $clave);
    }
    public function test_respuesta_original_se_conserva_tras_otras_modificaciones(): void
    {
        [$casos, , $datos] = $this->preparar(); $clave = Existencias::uuid();
        $original = $casos->ejecutar('CREAR_VARIANTE', $datos, $clave);
        $casos->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $datos['identificador'], 'tipo' => 'ENTRADA', 'cantidad' => 4, 'motivo' => 'Recepción', 'versión_esperada' => 1], Existencias::uuid());
        self::assertSame($original, $casos->ejecutar('CREAR_VARIANTE', $datos, $clave));
        self::assertSame(4, $casos->consultar('VARIANTE', $datos['identificador'])['variante']['disponible']);
    }
    public function test_fallo_de_saldo_no_persiste_ni_movimiento_ni_respuesta(): void
    {
        [$casos, $repositorio, $datos] = $this->preparar();
        $casos->ejecutar('CREAR_VARIANTE', $datos, Existencias::uuid());
        try {
            $casos->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $datos['identificador'], 'tipo' => 'SALIDA', 'cantidad' => 4, 'motivo' => 'Salida', 'versión_esperada' => 1], Existencias::uuid());
            self::fail('Debió rechazar la salida.');
        } catch (ErrorDeExistencias) {
            self::assertSame(1, $repositorio->revisión);
            self::assertSame([], $repositorio->existencias->variante($datos['identificador'])['movimientos']);
        }
    }
}
