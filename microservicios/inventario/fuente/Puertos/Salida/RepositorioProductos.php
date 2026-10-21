<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Salida;

use Clb\Inventario\Dominio\Producto;
use Clb\Inventario\Dominio\SkuDuplicado;

interface RepositorioProductos
{
    /** @throws SkuDuplicado Si el SKU ya existe, incluso ante registros concurrentes. */
    public function guardar(Producto $producto): void;

    public function listar(\Clb\Inventario\Dominio\ConsultaProductos $consulta): \Clb\Inventario\Dominio\PaginaProductos;

    public function buscarPorIdentificador(string $identificador, bool $incluirInactivos = false): ?Producto;

    public function registrarIdempotente(Producto $producto, \Clb\Inventario\Dominio\OperacionAdministrativa $operación): Producto;

    public function resultadoOperacion(\Clb\Inventario\Dominio\OperacionAdministrativa $operación): ?Producto;

    public function actualizar(Producto $producto, int $versiónEsperada, \Clb\Inventario\Dominio\OperacionAdministrativa $operación): Producto;
}
