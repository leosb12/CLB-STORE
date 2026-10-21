<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final class AdministracionNoAutorizada extends \DomainException
{
    public function __construct()
    {
        parent::__construct('Administración no autorizada. El modo local debe habilitarse explícitamente y no está permitido en producción.');
    }
}
