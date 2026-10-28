<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

// Salud operativa del proceso y de su base privada; no lee ni modifica datos de negocio.
final readonly class ControladorSaludHttp
{
    public function __invoke(): JsonResponse
    {
        try {
            DB::connection('mongodb')->getMongoDB()->command(['ping' => 1]);
            $mongo = 'ACTIVO';
        } catch (\Throwable) {
            $mongo = 'INACTIVO';
        }
        $activo = $mongo === 'ACTIVO';
        return response()->json(['estado' => $activo ? 'ACTIVO' : 'DEGRADADO', 'servicio' => 'inventario', 'dependencias' => ['mongodb' => $mongo]], $activo ? 200 : 503)
            ->header('Cache-Control', 'no-store');
    }
}
