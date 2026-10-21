<?php

declare(strict_types=1);

namespace Pruebas\Http;

use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\{Test, DataProvider};
use Pruebas\Soporte\PruebaConMongoDB;

final class AdministracionProductosHttpTest extends PruebaConMongoDB
{
    private function registrar(string $sku = 'CLB-ADMIN', ?string $clave = null): array
    {
        return $this->postJson('/api/v1/productos', [...$this->datos(), 'sku' => $sku, 'activo' => true],
            ['Idempotency-Key' => $clave ?? Str::uuid()->toString()])->assertCreated()->json('producto');
    }

    private function modificar(array $producto, array $cambios = [], ?string $clave = null): \Illuminate\Testing\TestResponse
    {
        $datos = array_intersect_key($producto, array_flip(['sku', 'nombre', 'descripción', 'categoría', 'precio', 'activo']));
        return $this->putJson('/api/v1/productos/'.$producto['identificador'], [...$datos,
            'versión_esperada' => $producto['versión_sincronización'], ...$cambios], ['Idempotency-Key' => $clave ?? Str::uuid()->toString()]);
    }

    #[Test]
    public function registroIdempotenteDevuelveElMismoResultadoPersistente(): void
    {
        $clave = Str::uuid()->toString();
        $primero = $this->registrar(clave: $clave);
        $segundo = $this->registrar(clave: $clave);
        self::assertSame($primero, $segundo);
        self::assertSame(1, $this->colección->countDocuments());
        $guardado = $this->colección->findOne(['_id' => $primero['identificador']]);
        self::assertCount(1, $guardado['clb_claves_operacion']);
        self::assertArrayNotHasKey('clb_claves_operacion', $primero);
        self::assertArrayNotHasKey('clb_resultados_operacion', $primero);
    }

    #[Test]
    public function edicionConservaIdentificadorFechaCreacionYPrecioExacto(): void
    {
        $original = $this->registrar();
        $editado = $this->modificar($original, ['nombre' => 'Camisa de año nuevo', 'sku' => ' clb-editado ', 'precio' => '0.29', 'descripción' => ''])
            ->assertOk()->assertJsonPath('producto.precio', '0.29')->assertJsonPath('producto.sku', 'CLB-EDITADO')
            ->assertJsonPath('producto.versión_sincronización', 2)->json('producto');
        self::assertSame($original['identificador'], $editado['identificador']);
        self::assertSame($original['fecha_creación'], $editado['fecha_creación']);
        self::assertGreaterThanOrEqual($original['fecha_actualización'], $editado['fecha_actualización']);
        self::assertSame(29, $this->colección->findOne(['_id' => $original['identificador']])['precio_centavos']);
    }

    #[Test]
    public function desactivaLogicamenteConsultaInactivosYReactiva(): void
    {
        $original = $this->registrar();
        $inactivo = $this->modificar($original, ['activo' => false])->assertOk()->assertJsonPath('producto.activo', false)->json('producto');
        $this->getJson('/api/v1/productos')->assertOk()->assertJsonCount(0, 'productos');
        $this->getJson('/api/v1/productos/'.$original['identificador'])->assertNotFound();
        $this->getJson('/api/v1/productos/administracion')->assertOk()->assertJsonCount(1, 'productos')->assertJsonPath('productos.0.activo', false);
        $this->getJson('/api/v1/productos/administracion/'.$original['identificador'])->assertOk()->assertJsonPath('producto.activo', false);
        self::assertSame(1, $this->colección->countDocuments());
        $this->modificar($inactivo, ['activo' => true])->assertOk()->assertJsonPath('producto.versión_sincronización', 3);
        $this->getJson('/api/v1/productos')->assertOk()->assertJsonCount(1, 'productos');
    }

    #[Test]
    public function unReintentoDeEdicionNoRepiteLaModificacionAunqueLaVersionAvance(): void
    {
        $original = $this->registrar();
        $clave = Str::uuid()->toString();
        $primero = $this->modificar($original, ['nombre' => 'Versión dos'], $clave)->assertOk()->json();
        $this->modificar($primero['producto'], ['nombre' => 'Versión tres'])->assertOk();
        $repetido = $this->modificar($original, ['nombre' => 'Versión dos'], $clave)->assertOk()->json();
        self::assertSame($primero, $repetido);
        $this->getJson('/api/v1/productos/administracion/'.$original['identificador'])->assertOk()
            ->assertJsonPath('producto.nombre', 'Versión tres')->assertJsonPath('producto.versión_sincronización', 3);
    }

    #[Test]
    public function registroRepetidoTrasUnaEdicionMantieneSuRespuestaOriginal(): void
    {
        $clave = Str::uuid()->toString();
        $original = $this->registrar(clave: $clave);
        $this->modificar($original, ['activo' => false])->assertOk();
        self::assertSame($original, $this->registrar(clave: $clave));
        $this->getJson('/api/v1/productos')->assertJsonCount(0, 'productos');
        self::assertSame(1, $this->colección->countDocuments());
    }

    #[Test]
    public function unaVersionDesactualizadaDevuelveElProductoActualSinSobrescribir(): void
    {
        $original = $this->registrar();
        $this->modificar($original, ['nombre' => 'Modificado por otra persona'])->assertOk();
        $this->modificar($original, ['nombre' => 'Propuesta atrasada'])->assertConflict()
            ->assertJsonPath('código', 'CONFLICTO_VERSION')->assertJsonPath('producto_actual.versión_sincronización', 2)
            ->assertJsonPath('producto_actual.nombre', 'Modificado por otra persona');
        self::assertSame('Modificado por otra persona', $this->colección->findOne(['_id' => $original['identificador']])['nombre']);
    }

    #[Test]
    public function mantieneUnicidadDeSkuEnRegistrosYModificaciones(): void
    {
        $primero = $this->registrar('CLB-UNO');
        $segundo = $this->registrar('CLB-DOS');
        $this->modificar($segundo, ['sku' => ' clb-uno '])->assertConflict()->assertJsonPath('errores.sku.0', 'Ya existe un producto con ese SKU.');
        $this->postJson('/api/v1/productos', [...$this->datos(), 'sku' => 'CLB-UNO'])->assertConflict();
        self::assertSame(2, $this->colección->countDocuments());
        self::assertSame(1, $this->colección->findOne(['_id' => $segundo['identificador']])['versión_sincronización']);
    }

    #[Test]
    #[DataProvider('edicionesInvalidas')]
    public function validaEdicionSinCambiarVersion(string $campo, mixed $valor): void
    {
        $original = $this->registrar();
        $this->modificar($original, [$campo => $valor])->assertUnprocessable()->assertJsonValidationErrors($campo, 'errores');
        self::assertSame(1, $this->colección->findOne(['_id' => $original['identificador']])['versión_sincronización']);
    }

    public static function edicionesInvalidas(): array
    {
        return [['precio', '0.00'], ['precio', 129.90], ['precio', '1.001'], ['precio', '-2'], ['nombre', ' '],
            ['categoría', ''], ['sku', 'SKU NO VALIDO'], ['activo', 'false'], ['descripción', null], ['versión_esperada', 0], ['versión_esperada', true]];
    }

    #[Test]
    public function noPermiteReutilizarClavesConOtrosDatosAccionesOProductos(): void
    {
        $clave = Str::uuid()->toString();
        $original = $this->registrar('CLB-UNO', $clave);
        $this->postJson('/api/v1/productos', [...$this->datos(), 'sku' => 'CLB-OTRO', 'activo' => true], ['Idempotency-Key' => $clave])
            ->assertConflict()->assertJsonPath('código', 'CONFLICTO_IDEMPOTENCIA');
        $this->modificar($original, ['nombre' => 'Cambio'], $clave)->assertConflict()->assertJsonPath('código', 'CONFLICTO_IDEMPOTENCIA');
        $otro = $this->registrar('CLB-DOS');
        $claveEdición = Str::uuid()->toString();
        $this->modificar($original, ['nombre' => 'Cambio'], $claveEdición)->assertOk();
        $this->modificar($otro, ['nombre' => 'Cambio'], $claveEdición)->assertConflict()->assertJsonPath('código', 'CONFLICTO_IDEMPOTENCIA');
        self::assertSame(1, $this->colección->findOne(['_id' => $otro['identificador']])['versión_sincronización']);
    }

    #[Test]
    public function exigeClaveIdempotenteValida(): void
    {
        foreach (['', 'clave-no-valida', str_repeat('a', 200)] as $clave) {
            $this->postJson('/api/v1/productos', $this->datos(), ['Idempotency-Key' => $clave])->assertUnprocessable();
        }
        self::assertSame(0, $this->colección->countDocuments());
    }

    #[Test]
    public function bloqueaAdministracionSinHabilitacionYConservaLecturaPublica(): void
    {
        $producto = $this->registrar();
        config(['administracion.local_habilitada' => false]);
        $this->postJson('/api/v1/productos', $this->datos())->assertForbidden();
        $this->modificar($producto)->assertForbidden();
        $this->getJson('/api/v1/productos/administracion')->assertForbidden();
        $this->getJson('/api/v1/productos/administracion/'.$producto['identificador'])->assertForbidden();
        $this->getJson('/api/v1/productos')->assertOk()->assertJsonCount(1, 'productos');
    }

    #[Test]
    public function produccionRechazaInclusoConBanderaLocalYHostFalsificado(): void
    {
        $this->app['env'] = 'production';
        $this->withHeaders(['Host' => 'localhost', 'X-Forwarded-For' => '127.0.0.1'])
            ->postJson('/api/v1/productos', $this->datos())->assertForbidden()->assertJsonPath('código', 'ADMINISTRACION_NO_AUTORIZADA');
    }

    #[Test]
    public function rechazaIpPublicaYOrigenExterno(): void
    {
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.42'])->withHeaders(['Host' => 'localhost', 'X-Forwarded-For' => '127.0.0.1'])
            ->postJson('/api/v1/productos', $this->datos())->assertForbidden();
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])->withHeaders(['Origin' => 'https://sitio-ajeno.example'])
            ->postJson('/api/v1/productos', $this->datos())->assertForbidden();
        $this->withHeaders(['Origin' => 'http://localhost', 'Sec-Fetch-Site' => 'cross-site'])
            ->postJson('/api/v1/productos', $this->datos())->assertForbidden();
    }

    #[Test]
    public function admiteModificarDocumentoLegadoSinMetadatosDeVersion(): void
    {
        $producto = $this->registrar();
        $this->colección->updateOne(['_id' => $producto['identificador']], ['$unset' => ['versión_sincronización' => '', 'fecha_actualización' => '']]);
        $this->modificar($producto, ['nombre' => 'Actualizado desde versión legada'])->assertOk()->assertJsonPath('producto.versión_sincronización', 2);
    }

    #[Test]
    public function conservaLosComprobantesAlAlcanzarElLimiteLocal(): void
    {
        $producto = $this->registrar();
        $claves = array_map(fn (int $número) => hash('sha256', (string) $número), range(1, 256));
        $this->colección->updateOne(['_id' => $producto['identificador']], ['$set' => ['clb_claves_operacion' => $claves]]);
        $this->modificar($producto, ['nombre' => 'No aplicado'])->assertUnprocessable()->assertJsonValidationErrors('operaciones', 'errores');
        self::assertCount(256, $this->colección->findOne(['_id' => $producto['identificador']])['clb_claves_operacion']);
    }
}
