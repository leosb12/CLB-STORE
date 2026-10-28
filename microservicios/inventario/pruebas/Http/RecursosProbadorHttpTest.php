<?php

declare(strict_types=1);

namespace Pruebas\Http;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Pruebas\Soporte\PruebaConMongoDB;

final class RecursosProbadorHttpTest extends PruebaConMongoDB
{
    private string $carpeta;

    protected function setUp(): void
    {
        parent::setUp();
        $this->carpeta = sys_get_temp_dir().'/clb_prueba_recursos_'.bin2hex(random_bytes(8));
        config(['recursos_probador.habilitado' => true, 'recursos_probador.directorio' => $this->carpeta]);
    }

    protected function tearDown(): void
    {
        if (is_dir($this->carpeta)) {
            foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->carpeta, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST) as $p) {
                $p->isDir() ? rmdir($p->getPathname()) : unlink($p->getPathname());
            }
            rmdir($this->carpeta);
        }
        parent::tearDown();
    }

    private function producto(): array
    {
        return $this->postJson('/api/v1/productos', [...$this->datos(), 'categoría' => 'Poleras', 'activo' => true], ['Idempotency-Key' => Str::uuid()->toString()])->assertCreated()->json('producto');
    }

    private function imagen(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('prenda.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAIAAAAEACAYAAAB7+X6nAAACgUlEQVR4nO3SQQEAEADAQGTQP4V+xPDYXYI9Ns/ed5C1fgfwlwHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4Ao+0BLOED2xXC/NMAAAAASUVORK5CYII='));
    }

    public function test_publicacion_idempotente_y_previsualizacion_privada(): void
    {
        $p = $this->producto();
        $id = $p['identificador'];
        $ruta = '/api/v1/productos/'.$id.'/recursos-probador';
        $clave = Str::uuid()->toString();
        $cargar = fn () => $this->post($ruta, ['imagen' => $this->imagen(), 'color' => 'Rojo', 'versión_esperada' => 1], ['Idempotency-Key' => $clave, 'Accept' => 'application/json']);
        $cargar()->assertStatus(202)->assertJsonPath('trabajo.estado', 'PENDIENTE');
        $cargar()->assertStatus(202);
        $trabajo = $this->postJson('/api/v1/interno/recursos-probador/reclamar')->assertOk()->json('trabajo');
        $binario = $this->imagen()->get();
        $sha = hash('sha256', $binario);
        $recurso = ['esquema' => 1, 'tipo' => 'superior', 'vista' => 'frontal', 'mime' => 'image/png', 'ancho' => 128, 'alto' => 256, 'bytes' => strlen($binario),
            'sha256' => $sha, 'modelo_sha256' => str_repeat('a', 64), 'metodo' => 'u2net-perfiles-1',
            'anclas' => ['izquierda' => .2, 'derecha' => .8, 'arriba' => .1, 'abajo' => .9, 'pecho' => .4, 'cuello' => [.5, .15], 'calidad' => .9]];
        $interno = '/api/v1/interno/recursos-probador/'.$id.'/'.$clave;
        $this->post($interno.'/resultado', ['datos' => json_encode(['estado' => 'LISTO', 'recurso' => $recurso]), 'textura' => $this->imagen(), 'maestro' => $this->imagen()], ['X-CLB-Reclamo' => $trabajo['reclamo'], 'Accept' => 'application/json'])->assertOk()->assertJsonPath('trabajo.estado', 'LISTO');
        $this->get('/api/v1/recursos-probador/'.$sha.'.png')->assertNotFound();
        $this->get($ruta.'/'.$clave.'/previsualizacion')->assertOk()->assertHeader('Content-Type', 'image/png');
        $publicar = Str::uuid()->toString();
        for ($i = 0; $i < 2; $i++) {
            $this->postJson($ruta.'/'.$clave.'/publicar', ['versión_esperada' => 1], ['Idempotency-Key' => $publicar])->assertOk()->assertJsonPath('trabajo.estado', 'PUBLICADO');
        }
        $this->getJson('/api/v1/productos/'.$id)->assertOk()->assertJsonPath('producto.versión_sincronización', 2)->assertJsonPath('producto.recurso_probador.sha256', $sha);
        $this->get('/api/v1/recursos-probador/'.$sha.'.png')->assertOk();
        // Restaurar una referencia publicada crea una versión nueva; repetir un recibo antiguo no la revierte.
        $restaurar = Str::uuid()->toString();
        $this->postJson($ruta.'/'.$clave.'/publicar', ['versión_esperada' => 2], ['Idempotency-Key' => $restaurar])->assertOk()->assertJsonPath('trabajo.recurso.version', 3);
        $this->postJson($ruta.'/'.$clave.'/publicar', ['versión_esperada' => 1], ['Idempotency-Key' => $publicar])->assertOk()->assertJsonPath('trabajo.recurso.version', 2);
        $this->getJson('/api/v1/productos/'.$id)->assertOk()->assertJsonPath('producto.versión_sincronización', 3)->assertJsonPath('producto.recurso_probador.version', 3);
    }

    /** PNG RGBA liso de 768×1024 sin GD (la imagen de pruebas no lo trae): cabecera, IDAT con zlib y fin. */
    private function png768(int $gris): string
    {
        $trozo = fn (string $tipo, string $datos) => pack('N', strlen($datos)).$tipo.$datos.pack('N', crc32($tipo.$datos));
        $fila = "\0".str_repeat(chr($gris).chr($gris).chr($gris)."\xff", 768);

        return "\x89PNG\r\n\x1a\n".$trozo('IHDR', pack('NNCCCCC', 768, 1024, 8, 6, 0, 0, 0))
            .$trozo('IDAT', (string) gzcompress(str_repeat($fila, 1024))).$trozo('IEND', '');
    }

    public function test_estandar_de_calidad_avisos_aceptados_espalda_publicada_y_rechazo_con_motivos(): void
    {
        $p = $this->producto();
        $id = $p['identificador'];
        $ruta = '/api/v1/productos/'.$id.'/recursos-probador';
        $preparar = function (array $datos, array $archivos) use ($ruta, $id) {
            $clave = Str::uuid()->toString();
            $this->post($ruta, ['imagen' => $this->imagen(), 'color' => 'Gris', 'versión_esperada' => 1], ['Idempotency-Key' => $clave, 'Accept' => 'application/json'])->assertStatus(202);
            $trabajo = $this->postJson('/api/v1/interno/recursos-probador/reclamar')->assertOk()->json('trabajo');

            return [$clave, $this->post('/api/v1/interno/recursos-probador/'.$id.'/'.$clave.'/resultado', ['datos' => json_encode($datos), ...$archivos],
                ['X-CLB-Reclamo' => $trabajo['reclamo'], 'Accept' => 'application/json'])];
        };
        // No apta: el trabajo queda en revisión con cada motivo del estándar y no se puede publicar.
        $noApta = \Pruebas\Dominio\RecursoProbadorTest::calidad('no_apta');
        $noApta['comprobaciones'][0]['nivel'] = 'bloqueo';
        [$rechazo, $r] = $preparar(['estado' => 'REQUIERE_REVISION', 'mensaje' => 'La prenda toca el borde.', 'calidad' => $noApta], []);
        $r->assertOk()->assertJsonPath('trabajo.estado', 'REQUIERE_REVISION')->assertJsonPath('trabajo.calidad.nivel', 'no_apta');
        $this->postJson($ruta.'/'.$rechazo.'/publicar', ['versión_esperada' => 1], ['Idempotency-Key' => Str::uuid()->toString()])->assertStatus(409);
        // Con avisos: se publica solo si se aceptan; la espalda del modelo 3D se publica junto a la textura.
        [$textura, $espalda] = [$this->png768(120), $this->png768(90)];
        $recurso = ['esquema' => 2, 'tipo' => 'superior', 'vista' => 'frontal', 'mime' => 'image/png', 'ancho' => 768, 'alto' => 1024,
            'bytes' => strlen($textura), 'sha256' => hash('sha256', $textura), 'modelo_sha256' => str_repeat('a', 64), 'metodo' => 'u2net-vton-1',
            'modelo3d' => \Pruebas\Dominio\RecursoProbadorTest::modelo3dSuperior(), 'espalda' => ['sha256' => hash('sha256', $espalda), 'bytes' => strlen($espalda)],
            'calidad' => \Pruebas\Dominio\RecursoProbadorTest::calidad()];
        $archivo = fn (string $b, string $n) => UploadedFile::fake()->createWithContent($n, $b);
        // Un LISTO que su propio informe declara no apto se rechaza.
        $preparar(['estado' => 'LISTO', 'recurso' => [...$recurso, 'calidad' => $noApta]],
            ['textura' => $archivo($textura, 't.png'), 'maestro' => $archivo($textura, 'm.png'), 'espalda' => $archivo($espalda, 'e.png')])[1]->assertStatus(422);
        [$clave, $r] = $preparar(['estado' => 'LISTO', 'recurso' => $recurso],
            ['textura' => $archivo($textura, 't.png'), 'maestro' => $archivo($textura, 'm.png'), 'espalda' => $archivo($espalda, 'e.png')]);
        $r->assertOk()->assertJsonPath('trabajo.estado', 'LISTO')->assertJsonPath('trabajo.calidad.nivel', 'con_avisos');
        $this->postJson($ruta.'/'.$clave.'/publicar', ['versión_esperada' => 1], ['Idempotency-Key' => Str::uuid()->toString()])->assertStatus(409);
        $this->postJson($ruta.'/'.$clave.'/publicar', ['versión_esperada' => 1, 'aceptar_avisos' => true], ['Idempotency-Key' => Str::uuid()->toString()])
            ->assertOk()->assertJsonPath('trabajo.estado', 'PUBLICADO');
        $producto = $this->getJson('/api/v1/productos/'.$id)->assertOk()->json('producto.recurso_probador');
        self::assertSame('con_avisos', $producto['calidad']['nivel']);
        self::assertCount(2, $producto['modelo3d']['superior']['mangas']);
        $this->get($producto['espalda']['ruta'])->assertOk()->assertHeader('Content-Type', 'image/png');
    }

    public function test_reclamo_sustituido_y_clave_con_otros_datos_se_rechazan(): void
    {
        $p = $this->producto();
        $ruta = '/api/v1/productos/'.$p['identificador'].'/recursos-probador';
        $clave = Str::uuid()->toString();
        $this->post($ruta, ['imagen' => $this->imagen(), 'color' => 'Rojo', 'versión_esperada' => 1], ['Idempotency-Key' => $clave])->assertStatus(202);
        $t = $this->postJson('/api/v1/interno/recursos-probador/reclamar')->json('trabajo');
        $this->post($ruta, ['imagen' => $this->imagen(), 'color' => 'Azul', 'versión_esperada' => 1], ['Idempotency-Key' => $clave, 'Accept' => 'application/json'])->assertStatus(409);
        $this->post($ruta, ['imagen' => $this->imagen(), 'color' => 'Azul', 'versión_esperada' => 1], ['Idempotency-Key' => Str::uuid()->toString()])->assertStatus(202);
        $this->post('/api/v1/interno/recursos-probador/'.$p['identificador'].'/'.$clave.'/resultado', ['datos' => json_encode(['estado' => 'ERROR'])], ['X-CLB-Reclamo' => $t['reclamo'], 'Accept' => 'application/json'])->assertStatus(409);
    }

    public function test_desactivado_y_archivo_disfrazado_se_rechazan(): void
    {
        $p = $this->producto();
        $ruta = '/api/v1/productos/'.$p['identificador'].'/recursos-probador';
        $this->post($ruta, ['imagen' => UploadedFile::fake()->createWithContent('foto.png', '<svg/>'), 'color' => 'Rojo', 'versión_esperada' => 1], ['Idempotency-Key' => Str::uuid()->toString(), 'Accept' => 'application/json'])->assertStatus(422);
        config(['recursos_probador.habilitado' => false]);
        $this->post($ruta, ['imagen' => $this->imagen(), 'color' => 'Rojo', 'versión_esperada' => 1], ['Idempotency-Key' => Str::uuid()->toString(), 'Accept' => 'application/json'])->assertStatus(503);
    }

    public function test_reclamo_vencido_se_recupera_y_rechaza_respuesta_antigua(): void
    {
        $p = $this->producto();
        $id = $p['identificador'];
        $clave = Str::uuid()->toString();
        $this->post('/api/v1/productos/'.$id.'/recursos-probador', ['imagen' => $this->imagen(), 'color' => 'Rojo', 'versión_esperada' => 1], ['Idempotency-Key' => $clave])->assertStatus(202);
        $primero = $this->postJson('/api/v1/interno/recursos-probador/reclamar')->json('trabajo');
        $this->colección->updateOne(['identificador' => $id], ['$set' => ['clb_recursos.hasta' => time() - 1]]);
        $segundo = $this->postJson('/api/v1/interno/recursos-probador/reclamar')->assertOk()->json('trabajo');
        self::assertNotSame($primero['reclamo'], $segundo['reclamo']);
        $ruta = '/api/v1/interno/recursos-probador/'.$id.'/'.$clave.'/resultado';
        $this->post($ruta, ['datos' => json_encode(['estado' => 'ERROR'])], ['X-CLB-Reclamo' => $primero['reclamo'], 'Accept' => 'application/json'])->assertStatus(409);
        $this->post($ruta, ['datos' => json_encode(['estado' => 'REQUIERE_REVISION', 'mensaje' => 'Prenda ambigua'])], ['X-CLB-Reclamo' => $segundo['reclamo'], 'Accept' => 'application/json'])->assertOk();
        $this->post($ruta, ['datos' => json_encode(['mensaje' => 'Prenda ambigua', 'estado' => 'REQUIERE_REVISION'])], ['X-CLB-Reclamo' => $segundo['reclamo'], 'Accept' => 'application/json'])->assertOk();
        $this->post($ruta,['datos' => json_encode(['estado' => 'ERROR'])],['X-CLB-Reclamo' => $segundo['reclamo'], 'Accept' => 'application/json'])->assertStatus(409);
    }
}
