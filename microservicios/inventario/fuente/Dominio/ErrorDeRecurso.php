<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final class ErrorDeRecurso extends \RuntimeException
{
    public function __construct(string $mensaje, public readonly int $estado = 422, public readonly string $código = 'RECURSO_INVALIDO')
    {
        parent::__construct($mensaje);
    }
}
