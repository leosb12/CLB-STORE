<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

use Clb\Inventario\Dominio\Producto;

interface PuertoConsultarProducto
{
    public function ejecutar(string $identificador, bool $incluirInactivos = false): Producto;
}
