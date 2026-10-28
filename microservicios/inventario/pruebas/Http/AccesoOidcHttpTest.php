<?php

declare(strict_types=1);

namespace Pruebas\Http;

use Clb\Inventario\Adaptadores\Entrada\LlavesIdentidad;
use Firebase\JWT\JWT;
use Pruebas\Soporte\PruebaConMongoDB;

/** Fase 7: administración exige rol admin y la API interna rol servicio, con tokens de Keycloak (firmados aquí con un JWKS local). */
final class AccesoOidcHttpTest extends PruebaConMongoDB
{
    private const EMISOR = 'http://127.0.0.1:18000/identidad/realms/clb';
    private string $privada = '';

    protected function setUp(): void
    {
        parent::setUp();
        config(['administracion.acceso' => 'oidc', 'administracion.identidad_emisor' => self::EMISOR, 'administracion.local_habilitada' => false]);
        $llave = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($llave, $this->privada);
        $rsa = openssl_pkey_get_details($llave)['rsa'];
        $base64 = fn (string $bytes) => rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
        $juego = ['keys' => [['kty' => 'RSA', 'kid' => 'prueba', 'alg' => 'RS256', 'use' => 'sig', 'n' => $base64($rsa['n']), 'e' => $base64($rsa['e'])]]];
        $this->app->instance(LlavesIdentidad::class, new class($juego) extends LlavesIdentidad {
            public function __construct(private readonly array $juegoLocal) {}
            public function juego(): array { return $this->juegoLocal; }
        });
    }

    private function token(array $roles, array $cambios = []): string
    {
        $ahora = time();
        return JWT::encode([...['iss' => self::EMISOR, 'aud' => 'clb-api', 'sub' => 'c0ffee00-0000-4000-8000-000000000001',
            'iat' => $ahora, 'exp' => $ahora + 300, 'realm_access' => ['roles' => $roles]], ...$cambios], $this->privada, 'RS256', 'prueba');
    }

    private function producto(array $cabeceras): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true], $cabeceras);
    }

    public function test_administracion_exige_token_y_rol_admin(): void
    {
        $this->producto([])->assertUnauthorized()->assertJsonPath('código', 'NO_AUTENTICADO');
        $this->producto(['Authorization' => 'Bearer '.$this->token(['cliente'])])->assertForbidden();
        $this->producto(['Authorization' => 'Bearer '.$this->token(['admin'])])->assertCreated()->assertHeaderMissing('X-CLB-Administracion');
    }

    public function test_api_interna_solo_para_servicios(): void
    {
        $this->postJson('/api/v1/interno/reservas', [], ['Authorization' => 'Bearer '.$this->token(['cliente'])])->assertForbidden();
        // Con rol servicio pasa la autorización y llega a la validación del contrato.
        $this->postJson('/api/v1/interno/reservas', [], ['Authorization' => 'Bearer '.$this->token(['servicio'])])->assertStatus(422);
        $this->getJson('/api/v1/interno/eventos', ['Authorization' => 'Bearer '.$this->token(['servicio'])])->assertOk();
    }

    public function test_tokens_de_otro_emisor_audiencia_vencidos_o_mal_formados_se_rechazan(): void
    {
        foreach ([$this->token(['admin'], ['iss' => 'http://atacante/realms/clb']), $this->token(['admin'], ['aud' => 'otra-api']),
            $this->token(['admin'], ['exp' => time() - 60]), 'no.es.jwt', $this->token(['admin']).'x'] as $token) {
            $this->producto(['Authorization' => 'Bearer '.$token])->assertUnauthorized();
        }
    }

    public function test_rotacion_de_llaves_descarga_el_juego_vigente_una_vez(): void
    {
        $nueva = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($nueva, $privadaNueva);
        $rsa = openssl_pkey_get_details($nueva)['rsa'];
        $base64 = fn (string $bytes) => rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
        $juegoNuevo = ['keys' => [['kty' => 'RSA', 'kid' => 'rotada', 'alg' => 'RS256', 'use' => 'sig', 'n' => $base64($rsa['n']), 'e' => $base64($rsa['e'])]]];
        $viejo = $this->app->make(LlavesIdentidad::class)->juego();
        $llaves = new class($viejo, $juegoNuevo) extends LlavesIdentidad {
            public int $descargas = 1;
            private array $vigente;
            public function __construct(array $viejo, private readonly array $nuevo) { $this->vigente = $viejo; }
            public function juego(): array { return $this->vigente; }
            public function olvidar(): void { $this->vigente = $this->nuevo; $this->descargas++; }
        };
        $this->app->instance(LlavesIdentidad::class, $llaves);
        $ahora = time();
        $token = JWT::encode(['iss' => self::EMISOR, 'aud' => 'clb-api', 'sub' => 's', 'iat' => $ahora, 'exp' => $ahora + 300,
            'realm_access' => ['roles' => ['admin']]], $privadaNueva, 'RS256', 'rotada');
        $this->producto(['Authorization' => 'Bearer '.$token])->assertCreated();
        self::assertSame(2, $llaves->descargas);
    }

    public function test_identidad_caida_responde_503_y_no_pide_iniciar_sesion(): void
    {
        $this->app->instance(LlavesIdentidad::class, new class extends LlavesIdentidad {
            public function __construct() {}
            public function juego(): array { throw new \Clb\Inventario\Dominio\IdentidadNoDisponible; }
        });
        $this->producto(['Authorization' => 'Bearer '.$this->token(['admin'])])->assertStatus(503)->assertJsonPath('código', 'IDENTIDAD_NO_DISPONIBLE');
    }

    public function test_catalogo_publico_sin_token(): void
    {
        $this->getJson('/api/v1/productos')->assertOk();
        $this->getJson('/salud')->assertOk();
    }
    public function test_recursos_fotograficos_exigen_roles_antes_de_validar_archivo(): void
    {
        config(['recursos_probador.habilitado'=>true]);
        $ruta='/api/v1/productos/'.str_repeat('a',32).'/recursos-probador';
        $this->postJson($ruta)->assertUnauthorized();
        $this->postJson($ruta,[],['Authorization'=>'Bearer '.$this->token(['cliente'])])->assertForbidden();
        $this->postJson($ruta,[],['Authorization'=>'Bearer '.$this->token(['servicio'])])->assertForbidden();
        $this->postJson($ruta,[],['Authorization'=>'Bearer '.$this->token(['admin'])])->assertStatus(422);
        $interno='/api/v1/interno/recursos-probador/reclamar';
        $this->postJson($interno)->assertUnauthorized();
        $this->postJson($interno,[],['Authorization'=>'Bearer '.$this->token(['cliente'])])->assertForbidden();
        $this->postJson($interno,[],['Authorization'=>'Bearer '.$this->token(['servicio'])])->assertOk();
    }

}
