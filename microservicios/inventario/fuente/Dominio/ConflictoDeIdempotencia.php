<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final class ConflictoDeIdempotencia extends \DomainException
{
    public function __construct()
    {
        parent::__construct('Esta Idempotency-Key ya se utilizó con otra solicitud. No se aplicó ningún cambio.');
    }
}
