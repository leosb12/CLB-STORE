<?php

declare(strict_types=1);

namespace Pruebas\Dominio;

use Clb\Inventario\Dominio\CodigoSku;
use Clb\Inventario\Dominio\PrecioEnBolivianos;
use Clb\Inventario\Dominio\Producto;
use Clb\Inventario\Dominio\ReglaDeProductoIncumplida;
use DateTimeImmutable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class ProductoTest extends TestCase
{
    #[Test]
    public function conservaLosCaracteresEspañolesYNormalizaElSku(): void
    {
        $producto = $this->producto('  Camisa de diseño  ', '  Ropa de año nuevo  ');
        self::assertSame('CLB-CAMISA-1', $producto->sku->valor);
        self::assertSame('Camisa de diseño', $producto->nombre);
        self::assertSame('Ropa de año nuevo', $producto->categoría);
        self::assertSame('Confección boliviana', $producto->descripción);
        self::assertFalse($producto->activo);
    }

    #[Test]
    #[DataProvider('preciosExactos')]
    public function representaElPrecioSinFlotantes(string $entrada, int $centavos, string $salida): void
    {
        $precio = new PrecioEnBolivianos($entrada);
        self::assertSame($centavos, $precio->centavos);
        self::assertSame($salida, $precio->comoTexto());
    }

    public static function preciosExactos(): array
    {
        return [['0.01', 1, '0.01'], ['0.29', 29, '0.29'], ['129.9', 12990, '129.90'],
            ['10', 1000, '10.00'], ['999999999.99', 99999999999, '999999999.99']];
    }

    #[Test]
    #[DataProvider('preciosInválidos')]
    public function rechazaPreciosInválidos(string $importe): void
    {
        $this->expectException(ReglaDeProductoIncumplida::class);
        new PrecioEnBolivianos($importe);
    }

    public static function preciosInválidos(): array
    {
        return array_map(fn (string $importe) => [$importe],
            ['', '0', '0.00', '-1', '1.001', '1e2', 'NaN', '1,50', ' 1.00', '1000000000', '00.10']);
    }

    #[Test]
    #[DataProvider('textosObligatorios')]
    public function exigeNombreYCategoría(string $nombre, string $categoría): void
    {
        $this->expectException(ReglaDeProductoIncumplida::class);
        $this->producto($nombre, $categoría);
    }

    public static function textosObligatorios(): array
    {
        return [['', 'Camisas'], ['   ', 'Camisas'], ['Camisa', ''], ['Camisa', "\u{00a0}"],
            [str_repeat('ñ', 161), 'Camisas'], ['Camisa', str_repeat('ñ', 101)]];
    }

    #[Test]
    #[DataProvider('códigosInválidos')]
    public function exigeUnSkuVálido(string $valor): void
    {
        $this->expectException(ReglaDeProductoIncumplida::class);
        new CodigoSku($valor);
    }

    public static function códigosInválidos(): array
    {
        return [[''], [' '], ['CLB CAMISA'], ['<sku>'], [str_repeat('A', 65)]];
    }

    private function producto(string $nombre, string $categoría): Producto
    {
        return new Producto(str_repeat('a', 32), new CodigoSku(' clb-camisa-1 '), $nombre,
            'Confección boliviana', $categoría, new PrecioEnBolivianos('129.90'), false,
            new DateTimeImmutable('2026-10-18T12:00:00Z'));
    }
}
