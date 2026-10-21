<?php

declare(strict_types=1);

namespace Pruebas\Integracion;

use Clb\Inventario\Aplicacion\DatosRegistroProducto;
use Clb\Inventario\Dominio\SkuDuplicado;
use Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Driver\Exception\BulkWriteException;
use PHPUnit\Framework\Attributes\Test;
use Pruebas\Soporte\PruebaConMongoDB;

final class RegistroMongoDBTest extends PruebaConMongoDB
{
    #[Test]
    public function registraUnProductoRealConPrecioEnteroYFechaBson(): void
    {
        $producto = $this->app->make(PuertoRegistrarProducto::class)->ejecutar(new DatosRegistroProducto(...$this->datos()));
        $guardado = $this->colección->findOne(['_id' => $producto->identificador]);
        self::assertNotNull($guardado);
        self::assertSame('Camisa de diseño', $guardado['nombre']);
        self::assertSame('Confección boliviana para año nuevo', $guardado['descripción']);
        self::assertSame('Camisas', $guardado['categoría']);
        self::assertSame(12990, $guardado['precio_centavos']);
        self::assertSame('BOB', $guardado['moneda']);
        self::assertFalse($guardado['activo']);
        self::assertInstanceOf(UTCDateTime::class, $guardado['fecha_creación']);
        $índices = iterator_to_array($this->colección->listIndexes());
        $únicos = array_filter($índices, fn ($índice) => $índice->getName() === 'clb_sku_unico' && $índice->isUnique());
        self::assertCount(1, $únicos);
    }

    #[Test]
    public function traduceElConflictoRealDelÍndiceAlErrorDeDominio(): void
    {
        $caso = $this->app->make(PuertoRegistrarProducto::class);
        $caso->ejecutar(new DatosRegistroProducto(...$this->datos()));
        $datos = $this->datos();
        $datos['sku'] = ' clb-camisa-1 ';
        try {
            $caso->ejecutar(new DatosRegistroProducto(...$datos));
            self::fail('Debió rechazar el SKU duplicado.');
        } catch (SkuDuplicado) {
            self::assertSame(1, $this->colección->countDocuments());
        }
    }

    #[Test]
    public function mongoImpideDuplicadosInclusoSinPasarPorElCasoDeUso(): void
    {
        $this->app->make(PuertoRegistrarProducto::class)->ejecutar(new DatosRegistroProducto(...$this->datos()));
        $this->expectException(BulkWriteException::class);
        $this->colección->insertOne(['sku' => 'CLB-CAMISA-1']);
    }
}
