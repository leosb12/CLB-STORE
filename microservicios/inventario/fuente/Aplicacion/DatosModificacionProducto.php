<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

final readonly class DatosModificacionProducto
{
    public function __construct(
        public string $identificador,
        public string $sku,
        public string $nombre,
        public string $descripción,
        public string $categoría,
        public string $precio,
        public bool $activo,
        public int $versiónEsperada,
        public string $claveIdempotencia,
    ) {}
}
