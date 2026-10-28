<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Dominio\IdentidadNoDisponible;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Juego de llaves públicas (JWKS) de Keycloak, descargado por la red interna y guardado 5 minutos en caché de archivo:
 * el servidor de desarrollo arranca la aplicación por petición y una caché en memoria descargaría el JWKS cada vez.
 */
class LlavesIdentidad
{
    private const CLAVE = 'clb_jwks_identidad';

    public function __construct(private readonly string $url) {}

    /** @return array{keys: list<array<string, mixed>>} */
    public function juego(): array
    {
        return Cache::store('file')->remember(self::CLAVE, 300, function (): array {
            try {
                $respuesta = Http::timeout(3)->acceptJson()->get($this->url);
            } catch (\Throwable) {
                throw new IdentidadNoDisponible;
            }
            if (! $respuesta->ok() || ! is_array($respuesta->json('keys'))) throw new IdentidadNoDisponible;
            return $respuesta->json();
        });
    }

    /** Keycloak rotó sus llaves (kid desconocido): se olvida la caché para descargar el juego vigente. */
    public function olvidar(): void
    {
        Cache::store('file')->forget(self::CLAVE);
    }
}
