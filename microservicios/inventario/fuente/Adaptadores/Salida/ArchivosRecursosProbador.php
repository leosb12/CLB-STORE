<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Salida;

use Clb\Inventario\Dominio\ErrorDeRecurso;
use Clb\Inventario\Puertos\Salida\AlmacenRecursosProbador;

final readonly class ArchivosRecursosProbador implements AlmacenRecursosProbador
{
    public function __construct(private string $raíz) {}

    private function ruta(string $hash, string $tipo): string
    {
        if (! preg_match('/\A[a-f0-9]{64}\z/', $hash) || ! in_array($tipo, ['original', 'textura', 'maestro', 'publicado'], true)) {
            throw new ErrorDeRecurso('Recurso inexistente.', 404);
        }

        return $this->raíz.'/'.$tipo.'/'.$hash;
    }

    public function guardar(string $binario, string $tipo, string $descripcion = 'prenda de catalogo'): array
    {
        if (! in_array($tipo, ['original', 'textura', 'maestro'], true) || strlen($binario) > 10485760 || strlen($binario) < 24) {
            throw new ErrorDeRecurso('El archivo está vacío o supera 10 MiB.');
        }
        $medidas = @getimagesizefromstring($binario);
        if (! $medidas || ! in_array($medidas['mime'], ['image/jpeg', 'image/png'], true)
            || $medidas[0] * $medidas[1] > 20000000 || min($medidas[0], $medidas[1]) < 128) {
            throw new ErrorDeRecurso('Solo se admite una fotografía JPEG/PNG válida de 128 px a 20 MP.');
        }
        if ($tipo !== 'original' && ($medidas['mime'] !== 'image/png' || max($medidas[0], $medidas[1]) > ($tipo === 'textura' ? 1024 : 2048)
            || substr($binario, 0, 8) !== "\x89PNG\r\n\x1a\n" || ord($binario[25]) !== 6)) {
            throw new ErrorDeRecurso('El resultado debe ser PNG RGBA dentro de las dimensiones permitidas.');
        }
        $hash = hash('sha256', $binario);
        $ruta = $this->ruta($hash, $tipo);
        $this->escribir($ruta, $binario);

        return ['sha256' => $hash, 'bytes' => strlen($binario), 'mime' => $medidas['mime'], 'ancho' => $medidas[0], 'alto' => $medidas[1]];
    }

    private function escribir(string $ruta, string $datos): void
    {
        if (is_file($ruta)) {
            if (! hash_equals(basename($ruta), hash_file('sha256', $ruta))) {
                throw new ErrorDeRecurso('El archivo almacenado está corrupto.', 503);
            }

            return;
        }
        $carpeta = dirname($ruta);
        if (! is_dir($carpeta) && ! mkdir($carpeta, 0770, true) && ! is_dir($carpeta)) {
            throw new ErrorDeRecurso('No se pudo preparar el almacenamiento.', 503);
        }
        $temporal = tempnam($carpeta, '.clb-');
        if ($temporal === false) {
            throw new ErrorDeRecurso('No hay espacio para preparar el archivo.', 503);
        }
        try {
            if (file_put_contents($temporal, $datos, LOCK_EX) !== strlen($datos)) {
                throw new ErrorDeRecurso('No se pudo guardar el archivo completo.', 503);
            }
            chmod($temporal, 0660);
            if (! rename($temporal, $ruta) && ! is_file($ruta)) {
                throw new ErrorDeRecurso('No se pudo confirmar el archivo.', 503);
            }
        } finally {
            if (is_file($temporal)) {
                unlink($temporal);
            }
        }
    }

    public function leer(string $hash, string $tipo): string
    {
        $ruta = $this->ruta($hash, $tipo);
        if (! is_file($ruta)) {
            throw new ErrorDeRecurso('El recurso no está disponible.', 404);
        }
        $datos = file_get_contents($ruta);
        if ($datos === false || ! hash_equals($hash, hash('sha256', $datos))) {
            throw new ErrorDeRecurso('El archivo almacenado está incompleto.', 503);
        }

        return $datos;
    }

    public function publicar(string $hash): void
    {
        $this->escribir($this->ruta($hash,'publicado'),$this->leer($hash,'textura'));
    }
}
