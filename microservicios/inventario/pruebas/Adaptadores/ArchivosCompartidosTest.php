<?php

declare(strict_types=1);

namespace Pruebas\Adaptadores;

use Clb\Inventario\Adaptadores\Salida\{ArchivosCompartidos, ArchivosRecursosProbador};
use Clb\Inventario\Dominio\ErrorDeRecurso;
use Illuminate\Http\Client\{Factory, Request};
use PHPUnit\Framework\TestCase;

final class ArchivosCompartidosTest extends TestCase
{
    private string $carpeta;

    protected function setUp(): void
    {
        $this->carpeta = sys_get_temp_dir().'/clb_prueba_archivos_'.bin2hex(random_bytes(8));
    }

    protected function tearDown(): void
    {
        if (! is_dir($this->carpeta)) return;
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->carpeta, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST) as $p) {
            $p->isDir() ? rmdir($p->getPathname()) : unlink($p->getPathname());
        }
        rmdir($this->carpeta);
    }

    private function imagen(): string
    {
        $imagen = imagecreatetruecolor(128, 256);
        imagealphablending($imagen, false);
        imagesavealpha($imagen, true);
        imagefill($imagen, 0, 0, imagecolorallocatealpha($imagen, 20, 100, 60, 0));
        ob_start();
        imagepng($imagen);
        return ob_get_clean();
    }

    private function adaptador(Factory $http): ArchivosCompartidos
    {
        return new ArchivosCompartidos(new ArchivosRecursosProbador($this->carpeta.'/cache'), $this->carpeta.'/comprobantes',
            'https://clientes.example', 'https://identidad.example/token', 'secreto-ficticio-de-prueba', $http);
    }

    public function test_respuesta_perdida_reutiliza_clave_bytes_y_ruta_sin_guardar_urls_firmadas(): void
    {
        $http = new Factory;
        $http->preventStrayRequests();
        $claves = [];
        $confirmaciones = 0;
        $subidas = 0;
        $binario = $this->imagen();
        $ruta = 's3://clb-pruebas/PRODUCTOS/ORIGINALES/polera-verde-frontal_2026-11-09_20-00-00-123_UTC_prueba.png';
        $http->fake(function (Request $r) use (&$claves, &$confirmaciones, &$subidas, $binario, $ruta) {
            if ($r->url() === 'https://identidad.example/token') {
                self::assertSame('clb-inventario', $r['client_id']);
                return Factory::response(['access_token' => 'token-ficticio', 'expires_in' => 300]);
            }
            if ($r->url() === 'https://clientes.example/api/v1/archivos/subidas') {
                $claves[] = $r->header('Idempotency-Key')[0];
                self::assertSame(hash('sha256', $binario), $r['sha256']);
                self::assertSame('original-prenda', $r['tipo']);
                self::assertStringContainsString('Polera verde', $r['descripcion']);
                return Factory::response(['subida' => ['url' => 'https://s3.example/objeto?firma=solo-memoria',
                    'cabeceras' => ['content-type' => 'image/png', 'if-none-match' => '*']]], 201);
            }
            if (str_starts_with($r->url(), 'https://s3.example/')) {
                self::assertEmpty($r->header('Authorization'), 'El token OIDC no debe enviarse a S3.');
                self::assertSame($binario, $r->body());
                self::assertSame('*', $r->header('if-none-match')[0]);
                return Factory::response('', ++$subidas === 1 ? 200 : 412);
            }
            if (str_ends_with($r->url(), '/confirmar')) {
                if (++$confirmaciones === 1) return Factory::failedConnection('Respuesta perdida después de recibir el objeto');
                return Factory::response(['archivo' => ['estado' => 'DISPONIBLE', 'ruta_s3' => $ruta]], 201);
            }
            self::fail('Solicitud no esperada: '.$r->method());
        });
        try {
            $this->adaptador($http)->guardar($binario, 'original', 'Polera verde frontal');
            self::fail('Debía conservar un resultado incierto.');
        } catch (ErrorDeRecurso $e) {
            self::assertStringNotContainsString('firma=', $e->getMessage());
        }
        $meta = $this->adaptador($http)->guardar($binario, 'original', 'Polera verde frontal');
        self::assertSame($claves[0], $claves[1]);
        self::assertSame($ruta, $meta['ruta_s3']);
        self::assertSame($meta, $this->adaptador($http)->guardar($binario, 'original', 'Polera verde frontal'));
        self::assertSame(2, $subidas);
        $comprobante = file_get_contents(glob($this->carpeta.'/comprobantes/*.json')[0]);
        self::assertStringNotContainsString('firma=', $comprobante);
        self::assertStringNotContainsString('token-ficticio', $comprobante);
    }

    public function test_lectura_remota_verifica_hash_y_publicacion_no_cambia_la_privacidad_s3(): void
    {
        $http = new Factory;
        $http->preventStrayRequests();
        $binario = $this->imagen();
        $corrupto = false;
        $http->fake(function (Request $r) use ($binario, &$corrupto) {
            if (str_ends_with($r->url(), '/token')) return Factory::response(['access_token' => 'ficticio']);
            if (str_ends_with($r->url(), '/subidas')) return Factory::response(['subida' => ['url' => 'https://s3.example/subida', 'cabeceras' => []]], 201);
            if ($r->url() === 'https://s3.example/subida') return Factory::response('', 200);
            if (str_ends_with($r->url(), '/confirmar')) return Factory::response(['archivo' => ['estado' => 'DISPONIBLE', 'ruta_s3' => 's3://clb-pruebas/MODELOS-3D/TEXTURAS/polera.png']]);
            if ($r->url() === 'https://s3.example/descarga') return Factory::response($corrupto ? 'contenido corrupto' : $binario);
            if (str_ends_with($r->url(), '/descarga')) return Factory::response(['url' => 'https://s3.example/descarga']);
            self::fail('Solicitud inesperada.');
        });
        $a = $this->adaptador($http);
        $meta = $a->guardar($binario, 'textura', 'Polera verde frontal');
        try {
            $a->leer($meta['sha256'], 'publicado');
            self::fail('Un borrador no debe estar publicado por existir en S3.');
        } catch (ErrorDeRecurso $e) {
            self::assertStringContainsString('no está disponible', $e->getMessage());
        }
        $a->publicar($meta['sha256']);
        self::assertSame($binario, $a->leer($meta['sha256'], 'publicado'));
        $corrupto = true;
        $this->expectException(ErrorDeRecurso::class);
        $a->leer($meta['sha256'], 'textura');
    }

    public function test_archivos_previos_siguen_leyendose_y_https_es_obligatorio(): void
    {
        $local = new ArchivosRecursosProbador($this->carpeta.'/cache');
        $binario = $this->imagen();
        $meta = $local->guardar($binario, 'original');
        $http = new Factory;
        $http->preventStrayRequests();
        self::assertSame($binario, $this->adaptador($http)->leer($meta['sha256'], 'original'));
        $this->expectException(\InvalidArgumentException::class);
        new ArchivosCompartidos($local, $this->carpeta.'/comprobantes', 'http://inseguro.example', 'https://identidad.example/token', 'ficticio', $http);
    }
}
