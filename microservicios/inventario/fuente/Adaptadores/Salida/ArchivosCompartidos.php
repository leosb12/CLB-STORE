<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Salida;

use Clb\Inventario\Dominio\ErrorDeRecurso;
use Clb\Inventario\Puertos\Salida\AlmacenRecursosProbador;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Str;

/** S3 mediante la API de Clientes. El volumen privado conserva claves y comprobantes de reintentos. */
final class ArchivosCompartidos implements AlmacenRecursosProbador
{
    private ?string $token = null;
    private int $vence = 0;

    public function __construct(private ArchivosRecursosProbador $local, private string $directorio,
        private string $base, private string $urlToken, private string $secreto, private Factory $http)
    {
        if (! str_starts_with($base, 'https://') || ! str_starts_with($urlToken, 'https://') || $secreto === '') {
            throw new \InvalidArgumentException('El almacenamiento compartido exige HTTPS y credenciales de servicio configuradas.');
        }
    }

    private function sesion(): string
    {
        if ($this->token === null || $this->vence <= time()) {
            $r = $this->http->asForm()->connectTimeout(3)->timeout(15)->post($this->urlToken,
                ['grant_type' => 'client_credentials', 'client_id' => 'clb-inventario', 'client_secret' => $this->secreto]);
            if (! $r->successful() || ! is_string($r->json('access_token'))) {
                throw new ErrorDeRecurso('No se pudo obtener la identidad de Inventario para archivos.', 503);
            }
            $this->token = $r->json('access_token');
            $this->vence = time() + max(1, (int) $r->json('expires_in', 60) - 30);
        }

        return $this->token;
    }

    private function api(string $metodo, string $ruta, ?array $datos = null, ?string $clave = null): array
    {
        $r = $this->http->withToken($this->sesion())->acceptJson()->connectTimeout(3)->timeout(30)
            ->withHeaders($clave ? ['Idempotency-Key' => $clave] : [])->send($metodo, rtrim($this->base, '/').'/api/v1/archivos'.$ruta,
                $datos === null ? [] : ['json' => $datos]);
        if (! $r->successful()) {
            throw new ErrorDeRecurso('El almacenamiento compartido no confirmó la operación. Reintenta con la misma clave.', 503);
        }

        return $r->json();
    }

    private function ruta(string $hash, string $tipo): string
    {
        if (! preg_match('/\A[a-f0-9]{64}\z/', $hash) || ! in_array($tipo, ['original', 'textura', 'maestro', 'publicado'], true)) {
            throw new ErrorDeRecurso('Recurso inexistente.', 404);
        }
        if (! is_dir($this->directorio) && ! mkdir($this->directorio, 0700, true) && ! is_dir($this->directorio)) {
            throw new ErrorDeRecurso('No se pudo preparar el registro durable de archivos.', 503);
        }

        return $this->directorio.'/'.$hash.'-'.($tipo === 'publicado' ? 'textura' : $tipo).'.json';
    }

    private function escribir(string $ruta, array $datos): void
    {
        $temporal = tempnam($this->directorio, '.clb-');
        if ($temporal === false) throw new ErrorDeRecurso('No se pudo preparar el comprobante de subida.', 503);
        try {
            $texto = json_encode($datos, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            if (file_put_contents($temporal, $texto, LOCK_EX) !== strlen($texto)) throw new \RuntimeException('Escritura incompleta.');
            chmod($temporal, 0600);
            if (! rename($temporal, $ruta)) throw new \RuntimeException('No se confirmó el comprobante.');
        } finally {
            if (is_file($temporal)) unlink($temporal);
        }
    }

    public function guardar(string $binario, string $tipo, string $descripcion = 'prenda de catalogo'): array
    {
        // Mantener exactamente las validaciones de calidad/dimensiones del adaptador original.
        $meta = $this->local->guardar($binario, $tipo, $descripcion);
        $ruta = $this->ruta($meta['sha256'], $tipo);
        $cerrojo = fopen($ruta.'.cerrojo', 'c');
        if ($cerrojo === false || ! flock($cerrojo, LOCK_EX)) throw new ErrorDeRecurso('La subida está ocupada.', 503);
        try {
            $registro = is_file($ruta) ? json_decode(file_get_contents($ruta), true, 32, JSON_THROW_ON_ERROR) : null;
            if ($registro === null) {
                $descripcion = trim(preg_replace('/\b[a-f0-9]{16,}\b|\b\d{6,}\b|[a-f0-9]{8}-[a-f0-9-]{27,}/i', '', $descripcion) ?? '');
                $registro = ['clave' => Str::uuid()->toString(), 'solicitud' => [
                    'tipo' => $tipo === 'original' ? 'original-prenda' : 'textura',
                    'descripcion' => mb_substr(($descripcion !== '' ? $descripcion : 'prenda de catalogo').' '.$tipo, 0, 120),
                    'mime' => $meta['mime'], 'bytes' => $meta['bytes'], 'sha256' => $meta['sha256'], 'origen' => 'microservicio',
                    'referencias' => ['sha256' => $meta['sha256'], 'funcion_inventario' => $tipo]]];
                $this->escribir($ruta, $registro); // Persistir ANTES de llamar a AWS: una respuesta incierta conserva la UUID.
            }
            if (! isset($registro['archivo'])) {
                $preparada = $this->api('POST', '/subidas', $registro['solicitud'], $registro['clave']);
                if (isset($preparada['subida'])) {
                    $subida = $preparada['subida'];
                    if (! str_starts_with($subida['url'], 'https://')) throw new \RuntimeException('Transporte inválido.');
                    $r = $this->http->connectTimeout(3)->timeout(90)->withHeaders($subida['cabeceras'])
                        ->withBody($binario, $meta['mime'])->put($subida['url']);
                    if (! $r->successful() && $r->status() !== 412) throw new \RuntimeException('Subida no confirmada.');
                    $preparada = $this->api('POST', '/'.$registro['clave'].'/confirmar', []);
                }
                $registro['archivo'] = $preparada['archivo'];
                if ($registro['archivo']['estado'] !== 'DISPONIBLE') throw new \RuntimeException('Archivo pendiente.');
                $this->escribir($ruta, $registro);
            }

            return [...$meta, 'ruta_s3' => $registro['archivo']['ruta_s3'], 'archivo_s3' => $registro['clave']];
        } catch (\Throwable) {
            // No propagar excepciones HTTP: pueden incluir la URL firmada o datos del proveedor.
            throw new ErrorDeRecurso('La subida no se confirmó. Se conserva su clave para reintentar sin duplicar archivos.', 503);
        } finally {
            flock($cerrojo, LOCK_UN);
            fclose($cerrojo);
        }
    }

    public function leer(string $hash, string $tipo): string
    {
        $ruta = $this->ruta($hash, $tipo);
        if (! is_file($ruta)) return $this->local->leer($hash, $tipo); // Recursos previos a la activación del adaptador.
        if ($tipo === 'publicado') $this->local->leer($hash, 'publicado'); // Nunca adelantar la publicación por existir en S3.
        try {
            $registro = json_decode(file_get_contents($ruta), true, 32, JSON_THROW_ON_ERROR);
            $descarga = $this->api('GET', '/'.$registro['clave'].'/descarga');
            if (! str_starts_with($descarga['url'], 'https://')) throw new \RuntimeException('Transporte inválido.');
            $r = $this->http->connectTimeout(3)->timeout(60)->get($descarga['url']);
            if (! $r->successful() || ! hash_equals($hash, hash('sha256', $r->body()))) throw new \RuntimeException('Integridad inválida.');

            return $r->body();
        } catch (\Throwable) {
            throw new ErrorDeRecurso('No se pudo verificar la descarga del archivo compartido.', 503);
        }
    }

    public function publicar(string $hash): void
    {
        // El caso de uso mantiene la autorización y los bloqueos de calidad. La publicación no cambia la ACL de S3.
        $this->local->publicar($hash);
    }
}
