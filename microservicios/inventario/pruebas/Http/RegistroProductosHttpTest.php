<?php

declare(strict_types=1);

namespace Pruebas\Http;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Pruebas\Soporte\PruebaConMongoDB;

final class RegistroProductosHttpTest extends PruebaConMongoDB
{
    #[Test]
    public function registraDesdeHttpYPersisteEnMongoDB(): void
    {
        $respuesta = $this->postJson('/api/v1/productos', $this->datos());
        $respuesta->assertCreated()->assertJsonPath('mensaje', 'Producto registrado correctamente.')
            ->assertJsonPath('producto.precio', '129.90')->assertJsonPath('producto.moneda', 'BOB')
            ->assertJsonPath('producto.activo', false)->assertJsonPath('producto.categoría', 'Camisas')
            ->assertJsonStructure(['producto' => ['identificador', 'sku', 'nombre', 'descripción', 'fecha_creación']]);
        self::assertSame(1, $this->colección->countDocuments(['_id' => $respuesta->json('producto.identificador')]));
    }

    #[Test]
    public function devuelve409CuandoElSkuYaExiste(): void
    {
        $this->postJson('/api/v1/productos', $this->datos())->assertCreated();
        $this->postJson('/api/v1/productos', $this->datos())->assertConflict()
            ->assertJsonPath('mensaje', 'Ya existe un producto con ese SKU.');
        self::assertSame(1, $this->colección->countDocuments());
    }

    #[Test]
    #[DataProvider('entradasInválidas')]
    public function devuelve422SinPersistir(string $campo, mixed $valor): void
    {
        $datos = $this->datos();
        $datos[$campo] = $valor;
        $this->postJson('/api/v1/productos', $datos)->assertUnprocessable()->assertJsonValidationErrors($campo, 'errores');
        self::assertSame(0, $this->colección->countDocuments());
    }

    public static function entradasInválidas(): array
    {
        return [['precio', '0.00'], ['precio', '-5'], ['precio', '1.001'], ['precio', 129.90],
            ['precio', 'NaN'], ['sku', ''], ['sku', ['invalidez' => true]], ['nombre', ' '],
            ['categoría', ''], ['activo', 'false'], ['activo', 1], ['descripción', null]];
    }

    #[Test]
    public function devuelveLosCamposObligatoriosEnEspañol(): void
    {
        $this->postJson('/api/v1/productos', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['sku', 'nombre', 'categoría', 'precio'], 'errores')
            ->assertJsonPath('errores.nombre.0', 'El campo nombre es obligatorio.');
    }

    #[Test]
    public function permiteDescripciónOmitidaYEstadoActivoPredeterminado(): void
    {
        $datos = $this->datos();
        unset($datos['activo'], $datos['descripción']);
        $this->postJson('/api/v1/productos', $datos)->assertCreated()
            ->assertJsonPath('producto.activo', true)->assertJsonPath('producto.descripción', '');
    }

    #[Test]
    public function noExponeOtrosCasosDeUso(): void
    {
        // La fase 3 habilita consultas; los demás casos continúan fuera del alcance.
        $this->getJson('/api/v1/productos')->assertOk();
        $this->deleteJson('/api/v1/productos/ejemplo')->assertStatus(405)
            ->assertJsonPath('mensaje', 'El método HTTP no está permitido para esta ruta.');
        $this->getJson('/ruta-inexistente')->assertNotFound()
            ->assertJsonPath('mensaje', 'La ruta solicitada no existe.');
    }

    #[Test]
    public function rechazaCamposDeFasesFuturas(): void
    {
        $this->postJson('/api/v1/productos', [...$this->datos(), 'stock' => 5])
            ->assertUnprocessable()->assertJsonValidationErrors('solicitud', 'errores');
        self::assertSame(0, $this->colección->countDocuments());
    }
}
