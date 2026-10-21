<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final class ProductoInexistente extends \DomainException
{
    public function __construct()
    {
        parent::__construct('El producto solicitado no existe o no está activo.');
    }
}
