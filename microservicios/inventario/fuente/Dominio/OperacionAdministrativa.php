<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final readonly class OperacionAdministrativa
{
    public string $identificador;
    public string $huella;

    public function __construct(string $clave, string $tipo, array $datos)
    {
        if (! preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i', $clave)) {
            throw new ReglaDeProductoIncumplida('Idempotency-Key', 'Idempotency-Key debe ser un UUID v4 válido.');
        }
        $this->identificador = hash('sha256', strtolower($clave));
        $this->huella = hash('sha256', json_encode([$tipo, $datos], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }
}
