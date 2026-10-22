<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final class ErrorDeExistencias extends \RuntimeException
{
    public function __construct(string $mensaje, public readonly int $estado = 422, public readonly ?array $actual = null)
    {
        parent::__construct($mensaje);
    }
}
