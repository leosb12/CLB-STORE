<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

/** No se pudo obtener el JWKS de Keycloak: no es una sesión inválida (401), sino una dependencia caída (503). */
final class IdentidadNoDisponible extends \DomainException
{
    public function __construct()
    {
        parent::__construct('No se pudo validar la sesión porque Identidad no responde. Reintenta en unos segundos.');
    }
}
