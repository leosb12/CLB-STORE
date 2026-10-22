<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Puertos\Entrada\{AccesoInternoInventario, AccesoAdministrativo};

final readonly class AccesoInternoLocal implements AccesoInternoInventario
{
    public function __construct(private AccesoAdministrativo $accesoLocal) {}
    public function autorizar(): void { $this->accesoLocal->autorizar(); }
}
