<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

use Clb\Inventario\Dominio\CodigoSku;
use Clb\Inventario\Dominio\PrecioEnBolivianos;
use Clb\Inventario\Dominio\Producto;
use Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto;
use Clb\Inventario\Puertos\Salida\RepositorioProductos;
use DateTimeImmutable;
use DateTimeZone;

final readonly class RegistrarProducto implements PuertoRegistrarProducto
{
    public function __construct(private RepositorioProductos $repositorio) {}

    public function ejecutar(DatosRegistroProducto $datos): Producto
    {
        $producto = new Producto(
            bin2hex(random_bytes(16)), new CodigoSku($datos->sku), $datos->nombre,
            $datos->descripción, $datos->categoría, new PrecioEnBolivianos($datos->precio),
            $datos->activo, new DateTimeImmutable('now', new DateTimeZone('UTC')),
        );
        if ($datos->claveIdempotencia !== null) {
            $operación = new \Clb\Inventario\Dominio\OperacionAdministrativa($datos->claveIdempotencia, 'REGISTRAR_PRODUCTO', [
                $datos->sku, $datos->nombre, $datos->descripción, $datos->categoría, $datos->precio, $datos->activo,
            ]);
            return $this->repositorio->registrarIdempotente($producto, $operación);
        }
        $this->repositorio->guardar($producto);

        return $producto;
    }
}
