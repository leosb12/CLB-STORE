<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

final readonly class DatosRegistroProducto
{
    public function __construct(
        public string $sku,
        public string $nombre,
        public string $descripción,
        public string $categoría,
        public string $precio,
        public bool $activo = true,
        public ?string $claveIdempotencia = null,
    ) {}
}
