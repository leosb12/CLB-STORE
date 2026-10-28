<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

use Clb\Inventario\Dominio\ErrorDeRecurso;
use Clb\Inventario\Dominio\RecursoProbador;
use Clb\Inventario\Puertos\Entrada\PuertoGestionarRecursosProbador;
use Clb\Inventario\Puertos\Salida\AlmacenRecursosProbador;
use Clb\Inventario\Puertos\Salida\RepositorioRecursosProbador;

final readonly class GestionarRecursosProbador implements PuertoGestionarRecursosProbador
{
    public function __construct(private RepositorioRecursosProbador $repositorio, private AlmacenRecursosProbador $archivos) {}

    private function clave(string $clave): void
    {
        if (! preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/', $clave)) {
            throw new ErrorDeRecurso('Idempotency-Key debe ser UUID v4.');
        }
    }

    private function cambiar(string $id, \Closure $operación): array
    {
        if (! preg_match('/\A[a-f0-9]{32}\z/', $id)) {
            throw new ErrorDeRecurso('Producto inexistente.', 404);
        }
        for ($intento = 0; $intento < 5; $intento++) {
            $p = $this->repositorio->leer($id);
            $flujo = $p['flujo'] ?? ['revision' => 0, 'trabajos' => [], 'actual' => null, 'pendiente' => false, 'hasta' => 0];
            [$nuevo, $respuesta, $publicar] = $operación($p, $flujo);
            if ($nuevo === null) {
                return $respuesta;
            }
            if ($this->repositorio->guardar($id, $flujo['revision'], $p['version'], $nuevo, $publicar)) {
                return $respuesta;
            }
        }
        throw new ErrorDeRecurso('El producto cambió durante la operación; reintenta con la misma clave.', 409, 'CONFLICTO_RECURSO');
    }

    public function cargar(string $id, string $clave, int $versión, string $color, string $binario): array
    {
        $this->clave($clave);
        if (trim($color) === '' || mb_strlen($color) > 80 || $versión < 1) {
            throw new ErrorDeRecurso('Indica color y versión válida.');
        }
        $archivo = $this->archivos->guardar($binario, 'original');
        $huella = hash('sha256', json_encode([$archivo['sha256'], $versión, $color], JSON_THROW_ON_ERROR));

        return $this->cambiar($id, function ($p, $f) use ($clave, $huella, $archivo, $versión, $color) {
            if (isset($f['trabajos'][$clave])) {
                $t = $f['trabajos'][$clave];
                if ($t['huella'] !== $huella) {
                    throw new ErrorDeRecurso('La clave identifica otra fotografía o versión.', 409, 'CONFLICTO_IDEMPOTENCIA');
                }

                return [null, $this->visible($t), null];
            }
            if ($p['version'] !== $versión) {
                throw new ErrorDeRecurso('El producto cambió. Actualiza antes de cargar.', 409, 'CONFLICTO_VERSION');
            }
            if (! in_array(mb_strtolower(trim($p['categoria'])), ['poleras', 'polera', 'camisas', 'camisa', 'camisetas', 'camiseta', 'chaqueta', 'chaquetas', 'suéter', 'sueter', 'suéteres', 'sueteres', 'buzo', 'buzos', 'polerón', 'poleron', 'polerones', 'abrigo', 'abrigos', 'pantalón', 'pantalon', 'pantalones', 'jean', 'jeans', 'falda', 'faldas', 'short', 'shorts', 'vestido', 'vestidos', 'enterizo', 'enterizos', 'superior', 'inferior', 'cuerpo completo'], true)) {
                throw new ErrorDeRecurso('Selecciona una categoría de prenda superior, inferior o de cuerpo completo.');
            }
            if (count($f['trabajos']) >= 32) {
                throw new ErrorDeRecurso('Se alcanzó el límite local de 32 trabajos. Requiere revisión técnica.');
            }
            if ($f['actual'] && in_array($f['trabajos'][$f['actual']]['estado'], ['PENDIENTE', 'PROCESANDO', 'LISTO'], true)) {
                $f['trabajos'][$f['actual']]['estado'] = 'ERROR';
                $f['trabajos'][$f['actual']]['mensaje'] = 'Sustituida por una nueva fotografía.';
            }
            $t = ['identificador' => $clave, 'estado' => 'PENDIENTE', 'huella' => $huella, 'original' => $archivo, 'version_base' => $versión,
                'color' => $color, 'intentos' => 0, 'creado' => gmdate('c'), 'mensaje' => 'Fotografía recibida.'];
            $f['trabajos'][$clave] = $t;
            $f['actual'] = $clave;
            $f['pendiente'] = true;
            $f['hasta'] = 0;

            return [$f, $this->visible($t), null];
        });
    }

    public function publico(string $hash): string
    {
        if (! preg_match('/\A[a-f0-9]{64}\z/', $hash) || ! $this->repositorio->publicado($hash)) {
            throw new ErrorDeRecurso('Recurso no publicado.', 404);
        }

        return $this->archivos->leer($hash, 'publicado');
    }

    public function consultar(string $id, string $trabajo): array
    {
        $p = $this->repositorio->leer($id);
        $t = $p['flujo']['trabajos'][$trabajo] ?? throw new ErrorDeRecurso('Trabajo inexistente.', 404);

        return $this->visible($t);
    }

    private function visible(array $t): array
    {
        return array_intersect_key($t, array_flip(['identificador', 'estado', 'color', 'creado', 'mensaje', 'recurso', 'version_publicada', 'calidad']));
    }

    public function reclamar(int $ahora): ?array
    {
        foreach ($this->repositorio->candidatas($ahora) as $id) {
            $resultado = $this->cambiar($id, function ($p, $f) use ($id, $ahora) {
                if (! $f['pendiente'] || $f['hasta'] > $ahora) {
                    return [null, [], null];
                }
                $t = &$f['trabajos'][$f['actual']];
                if ($t['intentos'] >= 3) {
                    $t['estado'] = 'ERROR';
                    $t['mensaje'] = 'El procesamiento agotó sus intentos. Repite la fotografía.';
                    $f['pendiente'] = false;

                    return [$f, [], null];
                }
                $t['estado'] = 'PROCESANDO';
                $t['intentos']++;
                $t['reclamo'] = bin2hex(random_bytes(16));
                $f['hasta'] = $ahora + 90;

                return [$f, ['producto' => $id, 'trabajo' => $t['identificador'], 'reclamo' => $t['reclamo'],
                    'categoria' => $p['categoria'], 'original' => $t['original']], null];
            });
            if ($resultado) {
                return $resultado;
            }
        }

        return null;
    }

    public function original(string $id, string $trabajo, string $reclamo): string
    {
        $p = $this->repositorio->leer($id);
        $f = $p['flujo'] ?? [];
        $t = $this->reclamado($f, $trabajo, $reclamo);

        return $this->archivos->leer($t['original']['sha256'], 'original');
    }

    private function reclamado(array $f, string $trabajo, string $reclamo): array
    {
        $t = $f['trabajos'][$trabajo] ?? [];
        if (($f['actual'] ?? '') !== $trabajo || ($t['estado'] ?? '') !== 'PROCESANDO' || ($f['hasta'] ?? 0) < time()
            || ! hash_equals($t['reclamo'] ?? '', $reclamo) || $reclamo === '') {
            throw new ErrorDeRecurso('El reclamo venció o fue sustituido.', 409, 'RECLAMO_VENCIDO');
        }

        return $t;
    }

    private function canonico(mixed $valor): mixed
    {
        if (! is_array($valor)) {
            return $valor;
        }
        if (! array_is_list($valor)) {
            ksort($valor, SORT_STRING);
        }

        return array_map($this->canonico(...), $valor);
    }

    public function finalizar(string $id, string $trabajo, string $reclamo, array $datos, ?string $textura, ?string $maestro, ?string $espalda = null): array
    {
        $huella = hash('sha256', json_encode($this->canonico($datos), JSON_THROW_ON_ERROR).hash('sha256', $textura ?? '').hash('sha256', $maestro ?? '').hash('sha256', $espalda ?? ''));

        return $this->cambiar($id, function ($p, $f) use ($trabajo, $reclamo, $datos, $textura, $maestro, $espalda, $huella) {
            // Una respuesta perdida puede repetirse mientras siga siendo el mismo reclamo.
            $previo = $f['trabajos'][$trabajo] ?? [];
            if (($f['actual'] ?? '') === $trabajo && in_array($previo['estado'] ?? '', ['LISTO', 'REQUIERE_REVISION', 'ERROR'], true)
                && $reclamo !== '' && hash_equals($previo['reclamo'] ?? '', $reclamo)) {
                if (($previo['huella_resultado'] ?? '') !== $huella) {
                    throw new ErrorDeRecurso('El reclamo ya finalizó con otro resultado.', 409, 'CONFLICTO_IDEMPOTENCIA');
                }

                return [null, $this->visible($previo), null];
            }
            $t = $this->reclamado($f, $trabajo, $reclamo);
            if (($datos['estado'] ?? '') === 'LISTO') {
                if (! is_array($datos['recurso'] ?? null)) {
                    throw new ErrorDeRecurso('Metadatos inválidos.');
                }
                $recurso = RecursoProbador::validar($datos['recurso']);
                // Lo grave nunca llega a publicarse, aunque el resultado diga LISTO.
                if (($recurso['calidad']['nivel'] ?? '') === 'no_apta') {
                    throw new ErrorDeRecurso('Una fotografía que no cumple el estándar no puede quedar lista para publicar.');
                }
                $archivo = $this->archivos->guardar($textura ?? '', 'textura');
                $originalMaestro = $this->archivos->guardar($maestro ?? '', 'maestro');
                if ($archivo['sha256'] !== $recurso['sha256'] || $archivo['bytes'] !== $recurso['bytes']
                    || $archivo['ancho'] !== $recurso['ancho'] || $archivo['alto'] !== $recurso['alto']) {
                    throw new ErrorDeRecurso('La textura no coincide con sus metadatos.');
                }
                if (isset($recurso['espalda'])) {
                    // Espalda deducida para la realidad aumentada: mismo formato y verificación que la textura.
                    $dorso = $this->archivos->guardar($espalda ?? '', 'textura');
                    if ($dorso['sha256'] !== $recurso['espalda']['sha256'] || $dorso['bytes'] !== $recurso['espalda']['bytes']
                        || $dorso['ancho'] !== 768 || $dorso['alto'] !== 1024) {
                        throw new ErrorDeRecurso('La espalda no coincide con sus metadatos.');
                    }
                    $recurso['espalda']['ruta'] = '/api/v1/recursos-probador/'.$dorso['sha256'].'.png';
                }
                $t['recurso'] = [...$recurso, 'color' => $t['color'], 'maestro_sha256' => $originalMaestro['sha256'],
                    'ruta' => '/api/v1/recursos-probador/'.$archivo['sha256'].'.png'];
                $t['estado'] = 'LISTO';
                $t['calidad'] = $recurso['calidad'] ?? null;
                $t['mensaje'] = ($recurso['calidad']['nivel'] ?? '') === 'con_avisos'
                    ? 'Cumple lo esencial, pero tiene avisos: revísalos antes de publicar.'
                    : 'Cumple el estándar. Revisa la fotografía preparada antes de publicarla.';
            } else {
                $t['estado'] = ($datos['estado'] ?? '') === 'REQUIERE_REVISION' ? 'REQUIERE_REVISION' : 'ERROR';
                $t['mensaje'] = mb_substr((string) ($datos['mensaje'] ?? 'No se pudo preparar la prenda.'), 0, 300);
                $t['calidad'] = isset($datos['calidad']) ? RecursoProbador::calidad($datos['calidad']) : null;
            }
            $t['huella_resultado'] = $huella;
            $f['trabajos'][$trabajo] = $t;
            $f['pendiente'] = false;
            $f['hasta'] = 0;

            return [$f, $this->visible($t), null];
        });
    }

    public function previsualizar(string $id, string $trabajo): string
    {
        $t = $this->consultar($id, $trabajo);
        if (! isset($t['recurso'])) {
            throw new ErrorDeRecurso('La previsualización aún no está disponible.', 404);
        }

        return $this->archivos->leer($t['recurso']['sha256'], 'textura');
    }

    public function publicar(string $id, string $trabajo, string $clave, int $versión, bool $aceptarAvisos = false): array
    {
        $this->clave($clave);

        return $this->cambiar($id, function ($p, $f) use ($trabajo, $clave, $versión, $aceptarAvisos) {
            $t = $f['trabajos'][$trabajo] ?? throw new ErrorDeRecurso('Trabajo inexistente.', 404);
            $previo = $f['comprobantes'][$clave] ?? null;
            if ($previo !== null) {
                if ($previo['trabajo'] !== $trabajo || $previo['version'] !== $versión) {
                    throw new ErrorDeRecurso('La clave identifica otra publicación.', 409, 'CONFLICTO_IDEMPOTENCIA');
                }

                return [null, $previo['resultado'], null];
            }
            if (count($f['comprobantes'] ?? []) >= 64) {
                throw new ErrorDeRecurso('Límite local de publicaciones alcanzado; requiere revisión técnica.');
            }
            $restauración = $t['estado'] === 'PUBLICADO';
            if (! $restauración && ($t['estado'] !== 'LISTO' || $f['actual'] !== $trabajo)) {
                throw new ErrorDeRecurso('Este trabajo no está listo para publicar.', 409);
            }
            if ($p['version'] !== $versión || (! $restauración && $t['version_base'] !== $versión)) {
                throw new ErrorDeRecurso('El producto cambió: prepara una fotografía con la versión actual.', 409, 'CONFLICTO_VERSION');
            }
            // Lo grave nunca se publica, aunque el trabajo LISTO sea anterior a la validación en finalizar.
            if (! $restauración && ($t['recurso']['calidad']['nivel'] ?? '') === 'no_apta') {
                throw new ErrorDeRecurso('La fotografía no cumple el estándar de calidad.', 409, 'NO_APTA');
            }
            // Estándar de calidad: con avisos solo se publica si el administrador los acepta explícitamente.
            if (! $restauración && ($t['recurso']['calidad']['nivel'] ?? '') === 'con_avisos' && ! $aceptarAvisos) {
                throw new ErrorDeRecurso('La fotografía tiene avisos de calidad: acéptalos para publicarla.', 409, 'AVISOS_SIN_ACEPTAR');
            }
            $this->archivos->publicar($t['recurso']['sha256']);
            if (isset($t['recurso']['espalda'])) {
                $this->archivos->publicar($t['recurso']['espalda']['sha256']);
            }
            $t['avisos_aceptados'] = ($t['recurso']['calidad']['nivel'] ?? '') === 'con_avisos';
            $t['estado'] = 'PUBLICADO';
            $t['clave_publicacion'] = $clave;
            $t['version_solicitada'] = $versión;
            $t['version_publicada'] = $versión + 1;
            $t['recurso']['version'] = $versión + 1;
            $f['trabajos'][$trabajo] = $t;
            $f['comprobantes'][$clave] = ['trabajo' => $trabajo, 'version' => $versión, 'resultado' => $this->visible($t)];
            $f['publicados'] = array_values(array_unique([...($f['publicados'] ?? []), $t['recurso']['sha256'],
                ...(isset($t['recurso']['espalda']) ? [$t['recurso']['espalda']['sha256']] : [])]));

            return [$f, $this->visible($t), $t['recurso']];
        });
    }
}
