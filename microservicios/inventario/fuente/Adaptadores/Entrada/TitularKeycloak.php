<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Dominio\NoAutenticado;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Http\Request;

/**
 * Titular de la solicitud según su token de Keycloak. Valida firma (JWKS), emisor público estable y audiencia clb-api.
 * Inventario valida cada token aunque llegue por la pasarela: defensa en profundidad.
 */
final readonly class TitularKeycloak
{
    public const AUDIENCIA = 'clb-api';

    /** @param list<string> $roles */
    private function __construct(public string $sub, public array $roles) {}

    public static function desde(Request $solicitud, LlavesIdentidad $llaves, string $emisor): self
    {
        $cabecera = (string) $solicitud->header('Authorization', '');
        if (! preg_match('/\ABearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\z/', $cabecera, $coincidencia)) throw new NoAutenticado;
        // Fuera del try: si Identidad no responde es un 503, no una sesión inválida.
        $juego = $llaves->juego();
        try {
            $datos = (array) JWT::decode($coincidencia[1], JWK::parseKeySet($juego, 'RS256'));
        } catch (\UnexpectedValueException $error) {
            // kid desconocido: Keycloak pudo rotar sus llaves; se descarga el juego vigente una sola vez.
            if (! str_contains($error->getMessage(), '"kid"')) throw new NoAutenticado('La sesión no es válida o venció. Inicia sesión de nuevo.');
            $llaves->olvidar();
            $juego = $llaves->juego();
            try {
                $datos = (array) JWT::decode($coincidencia[1], JWK::parseKeySet($juego, 'RS256'));
            } catch (\Throwable) {
                throw new NoAutenticado('La sesión no es válida o venció. Inicia sesión de nuevo.');
            }
        } catch (\Throwable) {
            throw new NoAutenticado('La sesión no es válida o venció. Inicia sesión de nuevo.');
        }
        $audiencia = $datos['aud'] ?? null;
        $audiencias = is_array($audiencia) ? $audiencia : [$audiencia];
        if (($datos['iss'] ?? null) !== $emisor || ! in_array(self::AUDIENCIA, $audiencias, true) || ! is_string($datos['sub'] ?? null)) {
            throw new NoAutenticado('La sesión no es válida o venció. Inicia sesión de nuevo.');
        }
        $roles = (array) (((array) ($datos['realm_access'] ?? []))['roles'] ?? []);
        return new self($datos['sub'], array_values(array_filter($roles, 'is_string')));
    }

    public function tieneAlguno(string ...$roles): bool
    {
        return array_intersect($roles, $this->roles) !== [];
    }
}
