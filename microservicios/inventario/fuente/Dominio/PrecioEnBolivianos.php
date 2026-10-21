<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

final readonly class PrecioEnBolivianos
{
    public int $centavos;

    public function __construct(string $importe)
    {
        if (! preg_match('/\A(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?\z/', $importe)) {
            throw new ReglaDeProductoIncumplida('precio', 'El precio debe ser un decimal positivo de hasta 999999999.99 BOB, con un máximo de dos decimales.');
        }
        $partes = explode('.', $importe);
        $centavos = ((int) $partes[0]) * 100 + (int) str_pad($partes[1] ?? '', 2, '0');
        if ($centavos <= 0) {
            throw new ReglaDeProductoIncumplida('precio', 'El precio debe ser mayor que cero.');
        }
        $this->centavos = $centavos;
    }

    public function comoTexto(): string
    {
        return intdiv($this->centavos, 100).'.'.str_pad((string) ($this->centavos % 100), 2, '0', STR_PAD_LEFT);
    }
}
