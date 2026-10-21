<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

// Punto de integración para el futuro adaptador OIDC/Keycloak con rol ADMIN.
interface AccesoAdministrativo
{
    public const ROL_REQUERIDO = 'ADMIN';

    public function autorizar(): void;
}
