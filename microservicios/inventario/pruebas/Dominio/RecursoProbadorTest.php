<?php

declare(strict_types=1);

namespace Pruebas\Dominio;

use Clb\Inventario\Dominio\ErrorDeRecurso;
use Clb\Inventario\Dominio\RecursoProbador;
use PHPUnit\Framework\TestCase;

final class RecursoProbadorTest extends TestCase
{
    public function test_recurso_generativo_admite_tres_tipos_sin_anclas_inventadas(): void
    {
        foreach (['superior', 'inferior', 'completo'] as $tipo) {
            $r = ['esquema' => 2, 'tipo' => $tipo, 'vista' => 'frontal', 'mime' => 'image/png',
                'sha256' => str_repeat('a', 64), 'modelo_sha256' => str_repeat('b', 64), 'metodo' => 'u2net-vton-1',
                'ancho' => 768, 'alto' => 1024, 'bytes' => 1024];
            self::assertSame($r, RecursoProbador::validar($r));
        }
    }

    public static function modelo3dSuperior(): array
    {
        $eje = fn (int $lado) => ['lado' => $lado, 'larga' => false, 'eje' => array_fill(0, 8, [.3, .2, .05])];

        return ['version' => 1, 'tipo' => 'superior', 'espalda' => 'deducida', 'color' => [120, 120, 120],
            'superior' => ['axila' => .3, 'cuello' => [.1, .45, .55, .14], 'torso' => array_fill(0, 14, [.2, .3, .7]), 'mangas' => [$eje(-1), $eje(1)]]];
    }

    public static function calidad(string $nivel = 'con_avisos'): array
    {
        return ['nivel' => $nivel, 'puntuacion' => $nivel === 'apta' ? 100 : 85, 'comprobaciones' => [
            ['codigo' => 'RESOLUCION', 'nivel' => $nivel === 'apta' ? 'ok' : 'aviso', 'mensaje' => 'Resolución justa.', 'valor' => 430.0, 'umbral' => '≥ 500 px'],
        ]];
    }

    public function test_esquema_2_conserva_modelo_3d_espalda_y_calidad_y_rechaza_contratos_abiertos(): void
    {
        $r = ['esquema' => 2, 'tipo' => 'superior', 'vista' => 'frontal', 'mime' => 'image/png',
            'sha256' => str_repeat('a', 64), 'modelo_sha256' => str_repeat('b', 64), 'metodo' => 'u2net-vton-1',
            'ancho' => 768, 'alto' => 1024, 'bytes' => 1024, 'modelo3d' => self::modelo3dSuperior(),
            'espalda' => ['sha256' => str_repeat('c', 64), 'bytes' => 900], 'calidad' => self::calidad(), 'extra' => 'se descarta'];
        $v = RecursoProbador::validar($r);
        self::assertSame(self::modelo3dSuperior(), $v['modelo3d']);
        self::assertSame(self::calidad(), $v['calidad']);
        self::assertArrayNotHasKey('extra', $v);
        $malos = [
            ['modelo3d' => [...self::modelo3dSuperior(), 'ruta' => '/etc/passwd']],
            ['modelo3d' => array_replace_recursive(self::modelo3dSuperior(), ['superior' => ['axila' => 'x']])],
            ['modelo3d' => array_replace_recursive(self::modelo3dSuperior(), ['superior' => ['torso' => [[2, .3, .7]]]])],
            ['espalda' => ['sha256' => 'no-hex', 'bytes' => 900]],
            ['calidad' => ['nivel' => 'perfecta', 'puntuacion' => 100, 'comprobaciones' => []]],
            ['calidad' => [...self::calidad(), 'comprobaciones' => [['codigo' => 'X1', 'nivel' => 'ok', 'mensaje' => str_repeat('a', 300), 'valor' => null, 'umbral' => '']]]],
        ];
        foreach ($malos as $cambio) {
            try {
                RecursoProbador::validar([...$r, ...$cambio]);
                self::fail('Debió rechazar '.json_encode(array_keys($cambio)));
            } catch (ErrorDeRecurso) {
                self::assertTrue(true);
            }
        }
    }

    private function recurso(): array
    {
        return ['esquema' => 1, 'tipo' => 'superior', 'vista' => 'frontal', 'mime' => 'image/png',
            'sha256' => str_repeat('a', 64), 'modelo_sha256' => str_repeat('b', 64), 'metodo' => 'u2net-perfiles-3',
            'ancho' => 512, 'alto' => 640, 'bytes' => 1024,
            'anclas' => ['izquierda' => .2, 'derecha' => .8, 'arriba' => .1, 'abajo' => .9,
                'cuello' => [.5, .15], 'pecho' => .4, 'calidad' => .9, 'estampados' => [[.3, .25, .7, .45]]]];
    }

    public function test_conserva_zonas_preparadas_y_acepta_recurso_anterior(): void
    {
        $r = $this->recurso();
        self::assertSame($r['anclas']['estampados'], RecursoProbador::validar($r)['anclas']['estampados']);
        $r['metodo'] = 'u2net-perfiles-2';
        unset($r['anclas']['estampados']);
        self::assertArrayNotHasKey('estampados', RecursoProbador::validar($r)['anclas']);
    }

    public function test_rechaza_coordenadas_invertidas_no_numericas_o_excesivas(): void
    {
        foreach (['texto', [[.3, .2, .1, .4]], [[.1, .2, NAN, .5]], [['.1', .2, .5, .6]], array_fill(0, 17, [.1, .2, .5, .6])] as $zonas) {
            $r = $this->recurso();
            $r['anclas']['estampados'] = $zonas;
            try {
                RecursoProbador::validar($r);
                self::fail('No debe aceptar zonas corruptas.');
            } catch (ErrorDeRecurso $error) {
                self::assertNotEmpty($error->getMessage());
            }
        }
    }

    public function test_metodo_nuevo_exige_preparacion_de_estampados(): void
    {
        $r = $this->recurso();
        unset($r['anclas']['estampados']);
        $this->expectException(ErrorDeRecurso::class);
        RecursoProbador::validar($r);
    }
}
