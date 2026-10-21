<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

use Clb\Inventario\Dominio\Producto;
use Clb\Inventario\Dominio\ProductoInexistente;
use Clb\Inventario\Puertos\Entrada\PuertoConsultarProducto;
use Clb\Inventario\Puertos\Salida\RepositorioProductos;

final readonly class ConsultarProducto implements PuertoConsultarProducto
{
    public function __construct(private RepositorioProductos $repositorio) {}

    public function ejecutar(string $identificador, bool $incluirInactivos = false): Producto
    {
        if (! preg_match('/\A[0-9a-f]{32}\z/', $identificador)) {
            throw new ProductoInexistente;
        }

        return $this->repositorio->buscarPorIdentificador($identificador, $incluirInactivos) ?? throw new ProductoInexistente;
    }
}
