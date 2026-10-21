<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

use Clb\Inventario\Dominio\ConsultaProductos;
use Clb\Inventario\Dominio\PaginaProductos;

interface PuertoListarProductos
{
    public function ejecutar(ConsultaProductos $consulta): PaginaProductos;
}
