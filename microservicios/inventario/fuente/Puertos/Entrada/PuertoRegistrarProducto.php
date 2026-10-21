<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

use Clb\Inventario\Aplicacion\DatosRegistroProducto;
use Clb\Inventario\Dominio\Producto;

interface PuertoRegistrarProducto
{
    public function ejecutar(DatosRegistroProducto $datos): Producto;
}
