<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Dominio\AdministracionNoAutorizada;
use Clb\Inventario\Puertos\Entrada\{AccesoAdministrativo, AccesoInternoInventario};
use Illuminate\Http\Request;

/**
 * Adaptadores OIDC de los puertos de acceso (fase 7): administración exige el rol admin de Keycloak y la API interna
 * (reservas, eventos) el rol servicio, que solo tienen los microservicios con client credentials.
 */
final readonly class AccesoOidc implements AccesoAdministrativo, AccesoInternoInventario
{
    /** @param list<string> $rolesPermitidos */
    public function __construct(private Request $solicitud, private LlavesIdentidad $llaves, private string $emisor, private array $rolesPermitidos) {}

    public function autorizar(): void
    {
        if (! TitularKeycloak::desde($this->solicitud, $this->llaves, $this->emisor)->tieneAlguno(...$this->rolesPermitidos)) {
            throw new AdministracionNoAutorizada('No tienes permiso para esta operación.');
        }
    }
}
