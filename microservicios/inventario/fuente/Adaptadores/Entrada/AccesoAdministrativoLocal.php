<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Dominio\AdministracionNoAutorizada;
use Clb\Inventario\Puertos\Entrada\AccesoAdministrativo;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\IpUtils;

// No autentica usuarios. Es una restricción temporal de desarrollo local.
final readonly class AccesoAdministrativoLocal implements AccesoAdministrativo
{
    public function __construct(private Application $aplicación, private Request $solicitud) {}

    public function autorizar(): void
    {
        if (! $this->aplicación->environment(['local', 'testing'])
            || config('administracion.local_habilitada') !== true
            || ! IpUtils::checkIp($this->solicitud->ip() ?? '', config('administracion.redes_locales'))) {
            throw new AdministracionNoAutorizada;
        }
        // Fetch Metadata evita escrituras desde páginas de otros orígenes en navegadores compatibles.
        if ($this->solicitud->header('Sec-Fetch-Site') === 'cross-site') throw new AdministracionNoAutorizada;
        $origen = $this->solicitud->header('Origin');
        if ($origen !== null && ! in_array(parse_url($origen, PHP_URL_HOST), ['localhost', '127.0.0.1', '[::1]'], true)) {
            throw new AdministracionNoAutorizada;
        }
    }
}
