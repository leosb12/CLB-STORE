<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

/** La solicitud no trae una sesión válida (HTTP 401); distinto de no tener permiso (403). */
final class NoAutenticado extends \DomainException
{
    public function __construct(string $mensaje = 'Se requiere iniciar sesión.')
    {
        parent::__construct($mensaje);
    }
}
