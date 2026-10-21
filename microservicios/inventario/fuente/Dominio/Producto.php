<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

use DateTimeImmutable;

final readonly class Producto
{
    public string $nombre;

    public string $descripción;

    public string $categoría;

    public DateTimeImmutable $fechaActualización;

    public function __construct(
        public string $identificador,
        public CodigoSku $sku,
        string $nombre,
        string $descripción,
        string $categoría,
        public PrecioEnBolivianos $precio,
        public bool $activo,
        public DateTimeImmutable $fechaCreación,
        ?DateTimeImmutable $fechaActualización = null,
        public int $versiónSincronización = 1,
    ) {
        if ($versiónSincronización < 1) {
            throw new ReglaDeProductoIncumplida('versión', 'La versión debe ser un entero positivo.');
        }
        if (! preg_match('/\A[0-9a-f]{32}\z/', $identificador)) {
            throw new ReglaDeProductoIncumplida('identificador', 'El identificador del producto no es válido.');
        }
        $nombre = preg_replace('/\A\s+|\s+\z/u', '', $nombre) ?? '';
        $categoría = preg_replace('/\A\s+|\s+\z/u', '', $categoría) ?? '';
        if ($nombre === '' || mb_strlen($nombre) > 160) {
            throw new ReglaDeProductoIncumplida('nombre', 'El nombre es obligatorio y debe tener hasta 160 caracteres.');
        }
        if ($categoría === '' || mb_strlen($categoría) > 100) {
            throw new ReglaDeProductoIncumplida('categoría', 'La categoría es obligatoria y debe tener hasta 100 caracteres.');
        }
        if (mb_strlen($descripción) > 5000) {
            throw new ReglaDeProductoIncumplida('descripción', 'La descripción debe tener hasta 5000 caracteres.');
        }
        $this->nombre = $nombre;
        $this->descripción = $descripción;
        $this->categoría = $categoría;
        $this->fechaActualización = $fechaActualización ?? $fechaCreación;
    }

    public function modificar(CodigoSku $sku, string $nombre, string $descripción, string $categoría, PrecioEnBolivianos $precio, bool $activo, DateTimeImmutable $fecha): self
    {
        return new self($this->identificador, $sku, $nombre, $descripción, $categoría, $precio, $activo,
            $this->fechaCreación, $fecha, $this->versiónSincronización + 1);
    }
}
