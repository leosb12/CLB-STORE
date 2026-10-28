<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Dominio\Producto;

final class RepresentacionProducto
{
    public static function de(Producto $producto): array
    {
        return [
            ...($producto->recursoProbador === null ? [] : ['recurso_probador' => $producto->recursoProbador]),
            'identificador' => $producto->identificador, 'sku' => $producto->sku->valor,
            'nombre' => $producto->nombre, 'descripción' => $producto->descripción,
            'categoría' => $producto->categoría, 'precio' => $producto->precio->comoTexto(),
            'moneda' => 'BOB', 'activo' => $producto->activo,
            'fecha_creación' => $producto->fechaCreación->format('Y-m-d\TH:i:s.u\Z'),
            'fecha_actualización' => $producto->fechaActualización->format('Y-m-d\TH:i:s.u\Z'),
            'versión_sincronización' => $producto->versiónSincronización,
        ];
    }
}
