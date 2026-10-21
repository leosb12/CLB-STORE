<?php

declare(strict_types=1);

namespace Pruebas\Aplicacion;

use Clb\Inventario\Aplicacion\DatosRegistroProducto;
use Clb\Inventario\Aplicacion\RegistrarProducto;
use Clb\Inventario\Dominio\ReglaDeProductoIncumplida;
use Clb\Inventario\Dominio\SkuDuplicado;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;
use Pruebas\Soporte\RepositorioProductosEnMemoria;

final class RegistrarProductoTest extends TestCase
{
    #[Test]
    public function registraSinLaravelNiMongoDBAlSustituirElAdaptador(): void
    {
        $repositorio = new RepositorioProductosEnMemoria;
        $caso = new RegistrarProducto($repositorio);
        $producto = $caso->ejecutar($this->datos());
        self::assertSame($producto, $repositorio->productos['CLB-1']);
        self::assertSame(12990, $producto->precio->centavos);
        self::assertTrue($producto->activo);
        self::assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $producto->identificador);
        self::assertSame('UTC', $producto->fechaCreación->getTimezone()->getName());
        $segundo = $caso->ejecutar($this->datos('CLB-2'));
        self::assertNotSame($producto->identificador, $segundo->identificador);
    }

    #[Test]
    public function rechazaUnSkuEquivalente(): void
    {
        $caso = new RegistrarProducto(new RepositorioProductosEnMemoria);
        $caso->ejecutar($this->datos());
        $this->expectException(SkuDuplicado::class);
        $caso->ejecutar($this->datos(' clb-1 '));
    }

    #[Test]
    public function noPersisteCuandoElPrecioEsInválido(): void
    {
        $repositorio = new RepositorioProductosEnMemoria;
        try {
            (new RegistrarProducto($repositorio))->ejecutar($this->datos(precio: '0.00'));
            self::fail('Debió rechazar el precio.');
        } catch (ReglaDeProductoIncumplida $error) {
            self::assertSame('precio', $error->campo);
            self::assertSame([], $repositorio->productos);
        }
    }

    private function datos(string $sku = 'CLB-1', string $precio = '129.90'): DatosRegistroProducto
    {
        return new DatosRegistroProducto($sku, 'Camisa', 'Diseño local', 'Camisas', $precio);
    }
}
