<?php

declare(strict_types=1);

namespace Pruebas\Aplicacion;

use Clb\Inventario\Aplicacion\{ConsultarProducto, ListarProductos, RegistrarProducto, DatosRegistroProducto};
use Clb\Inventario\Dominio\{ConsultaProductos, ProductoInexistente};
use PHPUnit\Framework\TestCase;
use Pruebas\Soporte\RepositorioProductosEnMemoria;

final class ConsultarProductosTest extends TestCase
{
    public function test_consulta_sin_framework_ni_base_de_datos(): void
    {
        $repositorio = new RepositorioProductosEnMemoria;
        $producto = (new RegistrarProducto($repositorio))->ejecutar(new DatosRegistroProducto('CLB-1', 'Camisa', 'Diseño', 'Camisas', '0.29'));
        self::assertSame($producto, (new ConsultarProducto($repositorio))->ejecutar($producto->identificador));
        self::assertSame([$producto], (new ListarProductos($repositorio))->ejecutar(new ConsultaProductos)->productos);
        self::assertSame($producto->fechaCreación, $producto->fechaActualización);
    }

    public function test_rechaza_identificador_inexistente(): void
    {
        $this->expectException(ProductoInexistente::class);
        (new ConsultarProducto(new RepositorioProductosEnMemoria))->ejecutar(str_repeat('a', 32));
    }

    public function test_nucleo_independiente_de_adaptadores(): void
    {
        foreach (['Dominio', 'Aplicacion', 'Puertos'] as $carpeta) {
            $archivos = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(dirname(__DIR__, 2).'/fuente/'.$carpeta));
            foreach ($archivos as $archivo) {
                if ($archivo->isFile() && $archivo->getExtension() === 'php') {
                    self::assertDoesNotMatchRegularExpression('/(?:Illuminate|MongoDB|Adaptadores)\\\\/', file_get_contents($archivo->getPathname()));
                }
            }
        }
    }
}
