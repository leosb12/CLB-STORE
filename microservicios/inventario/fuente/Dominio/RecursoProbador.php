<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

/** Metadatos de una textura final; no contiene rutas ni código del proveedor. */
final class RecursoProbador
{
    public static function validar(array $datos): array
    {
        if (($datos['esquema'] ?? null) === 2) {
            if (! in_array($datos['tipo'] ?? '', ['superior', 'inferior', 'completo'], true)
                || ($datos['metodo'] ?? '') !== 'u2net-vton-1' || ($datos['vista'] ?? '') !== 'frontal'
                || ($datos['mime'] ?? '') !== 'image/png' || ($datos['ancho'] ?? 0) !== 768 || ($datos['alto'] ?? 0) !== 1024
                || ! is_int($datos['bytes'] ?? null) || $datos['bytes'] < 26 || $datos['bytes'] > 10485760
                || ! preg_match('/\A[a-f0-9]{64}\z/', $datos['sha256'] ?? '')
                || ! preg_match('/\A[a-f0-9]{64}\z/', $datos['modelo_sha256'] ?? '')) {
                throw new ErrorDeRecurso('El recurso generativo no cumple el contrato.');
            }

            $resultado = array_intersect_key($datos, array_flip(['esquema', 'tipo', 'vista', 'mime', 'sha256', 'modelo_sha256', 'metodo', 'ancho', 'alto', 'bytes']));
            if (array_key_exists('modelo3d', $datos)) {
                $resultado['modelo3d'] = self::modelo3d($datos['modelo3d']);
                $e = $datos['espalda'] ?? null;
                if (! is_array($e) || array_keys($e) !== ['sha256', 'bytes'] || ! preg_match('/\A[a-f0-9]{64}\z/', $e['sha256'] ?? '')
                    || ! is_int($e['bytes']) || $e['bytes'] < 26 || $e['bytes'] > 10485760) {
                    throw new ErrorDeRecurso('La espalda del modelo 3D no cumple el contrato.');
                }
                $resultado['espalda'] = $e;
            }
            if (array_key_exists('calidad', $datos)) {
                $resultado['calidad'] = self::calidad($datos['calidad']);
            }

            return $resultado;
        }
        if (($datos['esquema'] ?? null) !== 1 || ($datos['tipo'] ?? null) !== 'superior' || ($datos['vista'] ?? null) !== 'frontal'
            || ($datos['mime'] ?? null) !== 'image/png' || ! preg_match('/\A[a-f0-9]{64}\z/', $datos['sha256'] ?? '')
            || ! preg_match('/\A[a-f0-9]{64}\z/', $datos['modelo_sha256'] ?? '') || ! in_array($datos['metodo'] ?? '', ['u2net-perfiles-1', 'u2net-perfiles-2', 'u2net-perfiles-3'], true)) {
            throw new ErrorDeRecurso('Los metadatos de procesamiento no cumplen el contrato.');
        }
        foreach (['ancho', 'alto', 'bytes'] as $campo) {
            if (! is_int($datos[$campo] ?? null) || $datos[$campo] < 1 || $datos[$campo] > ($campo === 'bytes' ? 10485760 : 1024)) {
                throw new ErrorDeRecurso('Las dimensiones o el tamaño de la textura no son válidos.');
            }
        }
        $a = $datos['anclas'] ?? [];
        if (! is_array($a)) {
            throw new ErrorDeRecurso('Anclas inválidas.');
        }
        if (($datos['metodo'] ?? '') === 'u2net-perfiles-3' && ! array_key_exists('estampados', $a)) {
            throw new ErrorDeRecurso('La preparación de estampados no está presente.');
        }
        foreach (['izquierda', 'derecha', 'arriba', 'abajo', 'pecho', 'calidad'] as $campo) {
            if ((! is_int($a[$campo] ?? null) && ! is_float($a[$campo] ?? null)) || ! is_finite((float) $a[$campo]) || $a[$campo] < 0 || $a[$campo] > 1) {
                throw new ErrorDeRecurso('Las anclas deben estar normalizadas sobre la textura.');
            }
        }
        $cuello = $a['cuello'] ?? [];
        if (! is_array($cuello) || ! array_is_list($cuello) || count($cuello) !== 2 || (! is_int($cuello[0]) && ! is_float($cuello[0])) || (! is_int($cuello[1]) && ! is_float($cuello[1]))
            || ! is_finite((float) $cuello[0]) || ! is_finite((float) $cuello[1])
            || $cuello[0] <= $a['izquierda'] || $cuello[0] >= $a['derecha'] || $cuello[1] < 0 || $cuello[1] > 1
            || ! ($a['arriba'] < $a['pecho'] && $a['pecho'] < $a['abajo']) || $a['calidad'] < .8 || $a['derecha'] - $a['izquierda'] <= .05 || $a['abajo'] - $a['arriba'] <= .05) {
            throw new ErrorDeRecurso('La geometría de la prenda requiere revisión.');
        }
        if (array_key_exists('estampados', $a)) {
            if (! is_array($a['estampados']) || ! array_is_list($a['estampados']) || count($a['estampados']) > 16) {
                throw new ErrorDeRecurso('Las zonas de estampado no cumplen el contrato.');
            }
            foreach ($a['estampados'] as $zona) {
                if (! is_array($zona) || ! array_is_list($zona) || count($zona) !== 4) {
                    throw new ErrorDeRecurso('Las zonas de estampado no cumplen el contrato.');
                }
                foreach ($zona as $coordenada) {
                    if ((! is_int($coordenada) && ! is_float($coordenada)) || ! is_finite((float) $coordenada) || $coordenada < 0 || $coordenada > 1) {
                        throw new ErrorDeRecurso('Las zonas de estampado deben estar normalizadas.');
                    }
                }
                if ($zona[0] >= $zona[2] || $zona[1] >= $zona[3]) {
                    throw new ErrorDeRecurso('Las zonas de estampado tienen dimensiones inválidas.');
                }
            }
        }
        $datos['anclas'] = array_intersect_key($a, array_flip(['izquierda', 'derecha', 'arriba', 'abajo', 'pecho', 'calidad', 'cuello', 'estampados']));

        return array_intersect_key($datos, array_flip(['esquema', 'tipo', 'vista', 'mime', 'sha256', 'modelo_sha256', 'metodo', 'ancho', 'alto', 'bytes', 'anclas']));
    }

    /** Informe del estándar de calidad de la foto (IA): nivel, puntuación y comprobaciones con mensaje acotado. */
    public static function calidad(mixed $c): array
    {
        if (! is_array($c) || array_keys($c) !== ['nivel', 'puntuacion', 'comprobaciones'] || ! in_array($c['nivel'], ['apta', 'con_avisos', 'no_apta'], true)
            || ! is_int($c['puntuacion']) || $c['puntuacion'] < 0 || $c['puntuacion'] > 100
            || ! is_array($c['comprobaciones']) || ! array_is_list($c['comprobaciones']) || count($c['comprobaciones']) > 16) {
            throw new ErrorDeRecurso('El informe de calidad no cumple el contrato.');
        }
        foreach ($c['comprobaciones'] as $x) {
            if (! is_array($x) || array_keys($x) !== ['codigo', 'nivel', 'mensaje', 'valor', 'umbral']
                || ! is_string($x['codigo']) || ! preg_match('/\A[A-Z0-9_]{2,32}\z/', $x['codigo']) || ! in_array($x['nivel'], ['ok', 'aviso', 'bloqueo'], true)
                || ! is_string($x['mensaje']) || mb_strlen($x['mensaje']) > 240 || ! is_string($x['umbral']) || mb_strlen($x['umbral']) > 24
                || ($x['valor'] !== null && ! is_int($x['valor']) && ! is_float($x['valor']))) {
                throw new ErrorDeRecurso('Una comprobación de calidad no cumple el contrato.');
            }
        }

        return $c;
    }

    private static function numeros(mixed $v, int $n, float $tope = 1.0): void
    {
        if (! is_array($v) || ! array_is_list($v) || count($v) !== $n) {
            throw new ErrorDeRecurso('El modelo 3D no cumple el contrato.');
        }
        foreach ($v as $x) {
            if ((! is_int($x) && ! is_float($x)) || ! is_finite((float) $x) || $x < 0 || $x > $tope) {
                throw new ErrorDeRecurso('El modelo 3D no cumple el contrato.');
            }
        }
    }

    private static function eje(mixed $e, array $claves): void
    {
        if (! is_array($e) || array_keys($e) !== $claves || ! in_array($e['lado'], [-1, 1], true) || ! is_array($e['eje']) || ! array_is_list($e['eje']) || count($e['eje']) !== 8) {
            throw new ErrorDeRecurso('El modelo 3D no cumple el contrato.');
        }
        foreach ($e['eje'] as $estación) {
            self::numeros($estación, 3);
        }
    }

    /** Mismo esquema cerrado que `validar_modelo_3d` del servicio de IA: solo números normalizados y listas acotadas. */
    public static function modelo3d(mixed $m): array
    {
        if (! is_array($m) || ($m['version'] ?? null) !== 1 || ! in_array($m['espalda'] ?? '', ['deducida', 'fotografiada'], true)
            || array_diff(array_keys($m), ['version', 'tipo', 'espalda', 'color', 'superior', 'inferior']) !== []) {
            throw new ErrorDeRecurso('El modelo 3D no cumple el contrato.');
        }
        self::numeros($m['color'] ?? null, 3, 255);
        if (in_array($m['tipo'] ?? '', ['superior', 'completo'], true)) {
            $s = $m['superior'] ?? null;
            if (! is_array($s) || array_keys($s) !== ['axila', 'cuello', 'torso', 'mangas'] || isset($m['inferior'])) {
                throw new ErrorDeRecurso('El torso del modelo 3D es inválido.');
            }
            self::numeros([$s['axila']], 1);
            self::numeros($s['cuello'], 4);
            if (! is_array($s['torso']) || ! array_is_list($s['torso']) || count($s['torso']) < 4 || count($s['torso']) > 32
                || ! is_array($s['mangas']) || ! array_is_list($s['mangas']) || count($s['mangas']) > 2) {
                throw new ErrorDeRecurso('El torso del modelo 3D es inválido.');
            }
            foreach ($s['torso'] as $fila) {
                self::numeros($fila, 3);
            }
            foreach ($s['mangas'] as $manga) {
                self::eje($manga, ['lado', 'larga', 'eje']);
                if (! is_bool($manga['larga'])) {
                    throw new ErrorDeRecurso('Las mangas del modelo 3D son inválidas.');
                }
            }
        } elseif (($m['tipo'] ?? '') === 'inferior') {
            $i = $m['inferior'] ?? null;
            if (! is_array($i) || array_keys($i) !== ['cintura', 'entrepierna', 'cadera', 'piernas'] || isset($m['superior'])
                || ! is_array($i['cadera']) || ! array_is_list($i['cadera']) || count($i['cadera']) < 2 || count($i['cadera']) > 8
                || ! is_array($i['piernas']) || ! array_is_list($i['piernas']) || count($i['piernas']) !== 2) {
                throw new ErrorDeRecurso('El pantalón del modelo 3D es inválido.');
            }
            self::numeros([$i['cintura'], $i['entrepierna']], 2);
            foreach ($i['cadera'] as $fila) {
                self::numeros($fila, 3);
            }
            foreach ($i['piernas'] as $pierna) {
                self::eje($pierna, ['lado', 'eje']);
            }
        } else {
            throw new ErrorDeRecurso('Tipo de prenda 3D desconocido.');
        }

        return $m;
    }
}
