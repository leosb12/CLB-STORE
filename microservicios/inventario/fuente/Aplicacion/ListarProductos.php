<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

use Clb\Inventario\Dominio\ConsultaProductos;
use Clb\Inventario\Dominio\PaginaProductos;
use Clb\Inventario\Puertos\Entrada\PuertoListarProductos;
use Clb\Inventario\Puertos\Salida\RepositorioProductos;

final readonly class ListarProductos implements PuertoListarProductos
{
    public function __construct(private RepositorioProductos $repositorio) {}

    public function ejecutar(ConsultaProductos $consulta): PaginaProductos
    {
        return $this->repositorio->listar($consulta);
    }
}
