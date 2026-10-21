<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

use Clb\Inventario\Dominio\{CodigoSku, PrecioEnBolivianos, Producto, ProductoInexistente, OperacionAdministrativa, ConflictoDeVersion, ReglaDeProductoIncumplida};
use Clb\Inventario\Puertos\Salida\RepositorioProductos;
use Clb\Inventario\Puertos\Entrada\PuertoModificarProducto;

final readonly class ModificarProducto implements PuertoModificarProducto
{
    public function __construct(private RepositorioProductos $repositorio) {}

    public function ejecutar(DatosModificacionProducto $datos): Producto
    {
        if ($datos->versiónEsperada < 1) {
            throw new ReglaDeProductoIncumplida('versión_esperada', 'La versión esperada debe ser positiva.');
        }
        $operación = new OperacionAdministrativa($datos->claveIdempotencia, 'MODIFICAR_PRODUCTO', [
            $datos->identificador, $datos->sku, $datos->nombre, $datos->descripción, $datos->categoría,
            $datos->precio, $datos->activo, $datos->versiónEsperada,
        ]);
        $anterior = $this->repositorio->resultadoOperacion($operación);
        if ($anterior !== null) return $anterior;
        $actual = $this->repositorio->buscarPorIdentificador($datos->identificador, true) ?? throw new ProductoInexistente;
        if ($actual->versiónSincronización !== $datos->versiónEsperada) throw new ConflictoDeVersion($actual);
        $modificado = $actual->modificar(new CodigoSku($datos->sku), $datos->nombre, $datos->descripción,
            $datos->categoría, new PrecioEnBolivianos($datos->precio), $datos->activo, new \DateTimeImmutable('now', new \DateTimeZone('UTC')));

        return $this->repositorio->actualizar($modificado, $datos->versiónEsperada, $operación);
    }
}
