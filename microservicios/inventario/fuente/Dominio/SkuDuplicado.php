<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

use DomainException;

final class SkuDuplicado extends DomainException
{
    public function __construct()
    {
        parent::__construct('Ya existe un producto con ese SKU.');
    }
}
