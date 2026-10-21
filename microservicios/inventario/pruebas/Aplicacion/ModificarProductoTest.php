<?php

declare(strict_types=1);

namespace Pruebas\Aplicacion;

use Clb\Inventario\Aplicacion\{RegistrarProducto, ModificarProducto, DatosRegistroProducto, DatosModificacionProducto};
use Clb\Inventario\Dominio\ConflictoDeVersion;
use PHPUnit\Framework\TestCase;
use Pruebas\Soporte\RepositorioProductosEnMemoria;

final class ModificarProductoTest extends TestCase
{
    public function test_edita_y_deduplica_sin_laravel_ni_mongodb(): void
    {
        $repositorio = new RepositorioProductosEnMemoria;
        $producto = (new RegistrarProducto($repositorio))->ejecutar(new DatosRegistroProducto('CLB-1', 'Camisa', 'Confección', 'Camisas', '129.90'));
        $datos = new DatosModificacionProducto($producto->identificador, 'CLB-2', 'Camisa de año nuevo', 'Diseño', 'Camisas', '0.29', false, 1, 'a1000000-0000-4000-8000-000000000001');
        $caso = new ModificarProducto($repositorio);
        $editado = $caso->ejecutar($datos);
        self::assertSame($editado, $caso->ejecutar($datos));
        self::assertSame(2, $editado->versiónSincronización);
        self::assertSame($producto->identificador, $editado->identificador);
        self::assertSame(29, $editado->precio->centavos);
        self::assertFalse($editado->activo);
        self::assertSame([], $repositorio->listar(new \Clb\Inventario\Dominio\ConsultaProductos)->productos);
    }

    public function test_no_sobrescribe_una_version_mas_reciente(): void
    {
        $repositorio = new RepositorioProductosEnMemoria;
        $producto = (new RegistrarProducto($repositorio))->ejecutar(new DatosRegistroProducto('CLB-1', 'Camisa', '', 'Camisas', '1.00'));
        $caso = new ModificarProducto($repositorio);
        $caso->ejecutar(new DatosModificacionProducto($producto->identificador, 'CLB-1', 'Nueva', '', 'Camisas', '2.00', true, 1, 'a1000000-0000-4000-8000-000000000001'));
        $this->expectException(ConflictoDeVersion::class);
        $caso->ejecutar(new DatosModificacionProducto($producto->identificador, 'CLB-1', 'Atrasada', '', 'Camisas', '3.00', true, 1, 'a1000000-0000-4000-8000-000000000002'));
    }
}
