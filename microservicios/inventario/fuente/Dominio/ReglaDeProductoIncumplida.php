<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

use DomainException;

final class ReglaDeProductoIncumplida extends DomainException
{
    public function __construct(public readonly string $campo, string $mensaje)
    {
        parent::__construct($mensaje);
    }
}
