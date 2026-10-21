<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final readonly class ConsultaProductos
{
    public function __construct(
        public int $página = 1,
        public int $límite = 24,
        public string $búsqueda = '',
        public string $categoría = '',
        public bool $incluirInactivos = false,
    ) {
        if ($página < 1 || $página > 1000000 || $límite < 1 || $límite > 100) {
            throw new ReglaDeProductoIncumplida('paginación', 'La página debe estar entre 1 y 1000000 y el límite entre 1 y 100.');
        }
        if (mb_strlen($búsqueda) > 160 || mb_strlen($categoría) > 100) {
            throw new ReglaDeProductoIncumplida('filtros', 'La búsqueda admite hasta 160 caracteres y la categoría hasta 100.');
        }
    }
}
