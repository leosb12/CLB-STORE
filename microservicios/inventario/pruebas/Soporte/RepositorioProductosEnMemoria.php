<?php

declare(strict_types=1);

namespace Pruebas\Soporte;

use Clb\Inventario\Dominio\Producto;
use Clb\Inventario\Dominio\SkuDuplicado;
use Clb\Inventario\Puertos\Salida\RepositorioProductos;

final class RepositorioProductosEnMemoria implements RepositorioProductos
{
    public array $productos = [];

    public function guardar(Producto $producto): void
    {
        if (isset($this->productos[$producto->sku->valor])) {
            throw new SkuDuplicado;
        }
        $this->productos[$producto->sku->valor] = $producto;
    }

    public function listar(\Clb\Inventario\Dominio\ConsultaProductos $consulta): \Clb\Inventario\Dominio\PaginaProductos
    {
        $productos = array_values(array_filter($this->productos, fn (Producto $producto) => ($consulta->incluirInactivos || $producto->activo)
            && ($consulta->búsqueda === '' || mb_stripos($producto->nombre, $consulta->búsqueda) !== false)
            && ($consulta->categoría === '' || $producto->categoría === $consulta->categoría)));
        usort($productos, fn (Producto $uno, Producto $otro) => strcmp($uno->nombre, $otro->nombre) ?: strcmp($uno->identificador, $otro->identificador));

        return new \Clb\Inventario\Dominio\PaginaProductos(array_slice($productos, ($consulta->página - 1) * $consulta->límite, $consulta->límite), count($productos));
    }

    public function buscarPorIdentificador(string $identificador, bool $incluirInactivos = false): ?Producto
    {
        foreach ($this->productos as $producto) {
            if ($producto->identificador === $identificador && ($incluirInactivos || $producto->activo)) {
                return $producto;
            }
        }
        return null;
    }

    private array $resultados = [];

    public function resultadoOperacion(\Clb\Inventario\Dominio\OperacionAdministrativa $operación): ?Producto
    {
        $resultado = $this->resultados[$operación->identificador] ?? null;
        if ($resultado === null) return null;
        if ($resultado[0] !== $operación->huella) throw new \Clb\Inventario\Dominio\ConflictoDeIdempotencia;
        return $resultado[1];
    }

    public function registrarIdempotente(Producto $producto, \Clb\Inventario\Dominio\OperacionAdministrativa $operación): Producto
    {
        $anterior = $this->resultadoOperacion($operación);
        if ($anterior !== null) return $anterior;
        $this->guardar($producto);
        $this->resultados[$operación->identificador] = [$operación->huella, $producto];
        return $producto;
    }

    public function actualizar(Producto $producto, int $versiónEsperada, \Clb\Inventario\Dominio\OperacionAdministrativa $operación): Producto
    {
        $anterior = $this->resultadoOperacion($operación);
        if ($anterior !== null) return $anterior;
        $actual = $this->buscarPorIdentificador($producto->identificador, true) ?? throw new \Clb\Inventario\Dominio\ProductoInexistente;
        if ($actual->versiónSincronización !== $versiónEsperada) throw new \Clb\Inventario\Dominio\ConflictoDeVersion($actual);
        $colisión = $this->productos[$producto->sku->valor] ?? null;
        if ($colisión && $colisión->identificador !== $producto->identificador) throw new SkuDuplicado;
        unset($this->productos[$actual->sku->valor]);
        $this->productos[$producto->sku->valor] = $producto;
        $this->resultados[$operación->identificador] = [$operación->huella, $producto];
        return $producto;
    }
}
