<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final readonly class CodigoSku
{
    public string $valor;

    public function __construct(string $valor)
    {
        $normalizado = strtoupper(trim($valor));
        if (! preg_match('/\A[A-Z0-9][A-Z0-9_-]{0,63}\z/', $normalizado)) {
            throw new ReglaDeProductoIncumplida('sku', 'El SKU es obligatorio y admite hasta 64 letras, dígitos, guiones o guiones bajos.');
        }
        $this->valor = $normalizado;
    }
}
