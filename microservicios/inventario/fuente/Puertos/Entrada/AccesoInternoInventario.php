<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

/** Futuro puerto de identidad entre servicios; actualmente solo admite el entorno local explícito. */
interface AccesoInternoInventario
{
    public function autorizar(): void;
}
