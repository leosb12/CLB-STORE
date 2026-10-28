<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Dominio\ErrorDeRecurso;
use Clb\Inventario\Puertos\Entrada\PuertoGestionarRecursosProbador;
use Illuminate\Http\Request;

final readonly class ControladorRecursosProbadorHttp
{
    public function __construct(private PuertoGestionarRecursosProbador $gestor) {}

    private function habilitado(): void
    {
        if (! config('recursos_probador.habilitado')) {
            throw new ErrorDeRecurso('La preparación fotográfica está desactivada.', 503, 'RECURSOS_DESACTIVADOS');
        }
    }

    public function capacidades()
    {
        return response()->json(['habilitado' => (bool) config('recursos_probador.habilitado')]);
    }

    public function cargar(Request $s, string $id)
    {
        $this->habilitado();
        $s->validate(['imagen' => 'required|file|max:10240', 'color' => 'required|string|max:80', 'versión_esperada' => 'required|integer|min:1|max:2147483646']);

        return response()->json(['trabajo' => $this->gestor->cargar($id, $s->header('Idempotency-Key', ''), (int) $s->input('versión_esperada'), $s->input('color'), $s->file('imagen')->get())], 202);
    }

    public function consultar(string $id, string $trabajo)
    {
        return response()->json(['trabajo' => $this->gestor->consultar($id, $trabajo)]);
    }

    public function previsualizar(string $id, string $trabajo)
    {
        return response($this->gestor->previsualizar($id, $trabajo), 200, ['Content-Type' => 'image/png', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function publicar(Request $s, string $id, string $trabajo)
    {
        $this->habilitado();
        $d = $s->validate(['versión_esperada' => 'required|integer|min:1|max:2147483646', 'aceptar_avisos' => 'sometimes|boolean']);

        return response()->json(['trabajo' => $this->gestor->publicar($id, $trabajo, $s->header('Idempotency-Key', ''), (int) $d['versión_esperada'], (bool) ($d['aceptar_avisos'] ?? false))]);
    }

    public function publico(string $hash)
    {
        return response($this->gestor->publico($hash), 200, ['Content-Type' => 'image/png', 'Cache-Control' => 'public, max-age=31536000, immutable', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function reclamar()
    {
        $this->habilitado();

        return response()->json(['trabajo' => $this->gestor->reclamar(time())]);
    }

    public function original(Request $s, string $id, string $trabajo)
    {
        return response($this->gestor->original($id, $trabajo, $s->header('X-CLB-Reclamo', '')), 200, ['Content-Type' => 'application/octet-stream', 'Cache-Control' => 'no-store']);
    }

    public function finalizar(Request $s, string $id, string $trabajo)
    {
        $this->habilitado();
        $s->validate(['datos' => 'required|string|max:16384', 'textura' => 'sometimes|file|max:10240', 'maestro' => 'sometimes|file|max:10240', 'espalda' => 'sometimes|file|max:10240']);
        try {
            $d = json_decode($s->input('datos'), true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ErrorDeRecurso('Metadatos JSON inválidos.');
        }
        if (! is_array($d)) {
            throw new ErrorDeRecurso('Metadatos inválidos.');
        }

        return response()->json(['trabajo' => $this->gestor->finalizar($id, $trabajo, $s->header('X-CLB-Reclamo', ''), $d, $s->file('textura')?->get(), $s->file('maestro')?->get(), $s->file('espalda')?->get())]);
    }
}
