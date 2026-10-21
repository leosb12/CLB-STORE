<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

use Clb\Inventario\Aplicacion\DatosModificacionProducto;
use Clb\Inventario\Dominio\Producto;

interface PuertoModificarProducto
{
    public function ejecutar(DatosModificacionProducto $datos): Producto;
}
