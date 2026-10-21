<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final readonly class PaginaProductos
{
    /** @param list<Producto> $productos */
    public function __construct(public array $productos, public int $total) {}
}
