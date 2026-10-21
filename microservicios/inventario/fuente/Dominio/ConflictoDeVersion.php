<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final class ConflictoDeVersion extends \DomainException
{
    public function __construct(public readonly Producto $actual)
    {
        parent::__construct('El producto cambió en el servidor. Revisa la versión actual antes de preparar otra operación.');
    }
}
