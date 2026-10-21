<?php

declare(strict_types=1);

namespace Pruebas\Http;

use PHPUnit\Framework\Attributes\Test;
use Pruebas\Soporte\PruebaConMongoDB;

final class ConsultaProductosHttpTest extends PruebaConMongoDB
{
    private function registrar(string $sku, string $nombre = 'Camisa de diseño', string $categoría = 'Camisas', bool $activo = true): string
    {
        return $this->postJson('/api/v1/productos', [...$this->datos(), 'sku' => $sku, 'nombre' => $nombre,
            'categoría' => $categoría, 'activo' => $activo])->assertCreated()->json('producto.identificador');
    }

    #[Test]
    public function listaSoloActivosYExponeContratoSinBson(): void
    {
        $identificador = $this->registrar('CLB-A');
        $this->registrar('CLB-B', activo: false);
        $respuesta = $this->getJson('/api/v1/productos')->assertOk()->assertJsonCount(1, 'productos')
            ->assertJsonPath('paginación.total', 1)->assertJsonPath('productos.0.identificador', $identificador)
            ->assertJsonPath('productos.0.precio', '129.90')->assertJsonPath('productos.0.versión_sincronización', 1)
            ->assertJsonStructure(['productos' => [['fecha_creación', 'fecha_actualización', 'activo', 'descripción']]]);
        self::assertArrayNotHasKey('_id', $respuesta->json('productos.0'));
        self::assertArrayNotHasKey('precio_centavos', $respuesta->json('productos.0'));
    }

    #[Test]
    public function consultaPorIdentificadorYOcultaInactivos(): void
    {
        $identificador = $this->registrar('CLB-A');
        $inactivo = $this->registrar('CLB-B', activo: false);
        $this->getJson('/api/v1/productos/'.$identificador)->assertOk()->assertJsonPath('producto.sku', 'CLB-A');
        foreach ([$inactivo, str_repeat('f', 32), 'invalido'] as $ausente) {
            $this->getJson('/api/v1/productos/'.$ausente)->assertNotFound()
                ->assertJsonPath('mensaje', 'El producto solicitado no existe o no está activo.');
        }
    }

    #[Test]
    public function buscaFiltraYPaginaConOrdenEstable(): void
    {
        $uno = $this->registrar('CLB-A', 'Camisa de diseño');
        $dos = $this->registrar('CLB-B', 'Camisa de diseño');
        $this->registrar('CLB-C', 'Camisa de lino', 'Lino');
        $this->registrar('CLB-D', 'Pantalón');
        $consulta = '/api/v1/productos?'.http_build_query(['búsqueda' => 'CAMISA', 'categoría' => 'Camisas', 'límite' => 1]);
        $primero = $this->getJson($consulta)->assertOk()->assertJsonPath('paginación.total', 2)
            ->assertJsonPath('paginación.páginas', 2)->json('productos.0.identificador');
        $segundo = $this->getJson($consulta.'&'.http_build_query(['página' => 2]))->assertOk()->json('productos.0.identificador');
        self::assertSame(min($uno, $dos), $primero);
        self::assertSame(max($uno, $dos), $segundo);
        $this->getJson('/api/v1/productos?'.http_build_query(['búsqueda' => '.*']))->assertOk()->assertJsonCount(0, 'productos');
        $this->getJson($consulta.'&'.http_build_query(['página' => 3]))->assertOk()->assertJsonCount(0, 'productos');
    }

    #[Test]
    public function validaLimitesYTiposDeConsulta(): void
    {
        foreach ([['límite' => 101], ['límite' => 0], ['página' => -1], ['página' => '1.5'],
            ['búsqueda' => ['invalido']], ['categoría' => str_repeat('ñ', 101)], ['orden' => 'inexistente']] as $consulta) {
            $this->getJson('/api/v1/productos?'.http_build_query($consulta))->assertUnprocessable();
        }
    }

    #[Test]
    public function leeProductosAnterioresSinModificarLosDocumentos(): void
    {
        $identificador = $this->registrar('CLB-ANTIGUO');
        $this->colección->updateOne(['_id' => $identificador], ['$unset' => ['fecha_actualización' => '', 'versión_sincronización' => '']]);
        $respuesta = $this->getJson('/api/v1/productos/'.$identificador)->assertOk()
            ->assertJsonPath('producto.versión_sincronización', 1);
        self::assertSame($respuesta->json('producto.fecha_creación'), $respuesta->json('producto.fecha_actualización'));
        self::assertArrayNotHasKey('versión_sincronización', $this->colección->findOne(['_id' => $identificador])->getArrayCopy());
    }

    #[Test]
    public function cargaDemostracionRepetibleMedianteRegistro(): void
    {
        self::assertSame(0, \Illuminate\Support\Facades\Artisan::call('clb:catalogo-demostracion'));
        self::assertSame(0, \Illuminate\Support\Facades\Artisan::call('clb:catalogo-demostracion'));
        self::assertSame(8, $this->colección->countDocuments());
        $this->getJson('/api/v1/productos')->assertOk()->assertJsonCount(8, 'productos');
    }
}
