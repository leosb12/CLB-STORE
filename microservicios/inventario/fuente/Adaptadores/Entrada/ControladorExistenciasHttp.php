<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Aplicacion\GestionarExistencias;
use Clb\Inventario\Dominio\ErrorDeExistencias;
use Clb\Inventario\Puertos\Entrada\PuertoGestionarExistencias;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

final readonly class ControladorExistenciasHttp
{
    public function __construct(private PuertoGestionarExistencias $casos) {}

    public function crear(Request $solicitud, string $id): JsonResponse
    {
        return $this->comando($solicitud, 'CREAR_VARIANTE', ['identificador', 'sku', 'talla', 'color', 'activo'], ['identificador_producto' => $id], 201);
    }

    public function modificar(Request $solicitud, string $id): JsonResponse
    {
        return $this->comando($solicitud, 'MODIFICAR_VARIANTE', ['sku', 'talla', 'color', 'activo', 'versión_esperada'], ['identificador_variante' => $id]);
    }

    public function movimiento(Request $solicitud, string $id): JsonResponse
    {
        return $this->comando($solicitud, 'REGISTRAR_MOVIMIENTO', ['tipo', 'cantidad', 'motivo', 'sentido', 'versión_esperada'], ['identificador_variante' => $id], 201);
    }

    public function mínimo(Request $solicitud, string $id): JsonResponse
    {
        return $this->comando($solicitud, 'CONFIGURAR_MINIMO', ['mínimo', 'versión_esperada'], ['identificador_variante' => $id]);
    }

    public function reservar(Request $solicitud): JsonResponse
    {
        return $this->comando($solicitud, 'RESERVAR', ['identificador', 'identificador_pedido', 'líneas'], [], 201);
    }

    public function consumir(Request $solicitud, string $id): JsonResponse
    {
        return $this->comando($solicitud, 'CONSUMIR_RESERVA', [], ['identificador_reserva' => $id]);
    }

    public function liberar(Request $solicitud, string $id): JsonResponse
    {
        return $this->comando($solicitud, 'LIBERAR_RESERVA', [], ['identificador_reserva' => $id]);
    }

    private function comando(Request $solicitud, string $tipo, array $campos, array $ruta, int $estado = 200): JsonResponse
    {
        $entrada = $solicitud->json()->all();
        if (array_diff(array_keys($entrada), $campos)) throw ValidationException::withMessages(['solicitud' => ['La solicitud contiene campos no admitidos.']]);
        // Orden canónico para que reordenar propiedades JSON no cambie la huella persistente.
        $datos = $ruta;
        foreach ($campos as $campo) if (array_key_exists($campo, $entrada)) $datos[$campo] = $entrada[$campo];
        return response()->json($this->casos->ejecutar($tipo, $datos, (string) $solicitud->header('Idempotency-Key')), $estado)->header('Cache-Control', 'no-store');
    }

    public function variantes(string $id): JsonResponse { return response()->json($this->casos->consultar('VARIANTES', $id)); }
    public function variante(string $id): JsonResponse { return response()->json($this->casos->consultar('VARIANTE', $id)); }
    public function variantesAdministrativas(string $id): JsonResponse { return response()->json($this->casos->consultar('VARIANTES', $id, true)); }
    public function varianteAdministrativa(string $id): JsonResponse { return response()->json($this->casos->consultar('VARIANTE', $id, true)); }
    public function movimientos(string $id): JsonResponse { return response()->json($this->casos->consultar('MOVIMIENTOS', $id, true)); }
    public function reserva(string $id): JsonResponse { return response()->json($this->casos->consultar('RESERVA', $id, true)); }
    public function eventos(Request $solicitud): JsonResponse
    {
        $desde = filter_var($solicitud->query->get('desde', '0'), FILTER_VALIDATE_INT);
        $límite = filter_var($solicitud->query->get('límite', '100'), FILTER_VALIDATE_INT);
        if ($desde === false || $límite === false) throw new ErrorDeExistencias(GestionarExistencias::CURSOR_INVÁLIDO);
        return response()->json($this->casos->eventosDesde($desde, $límite));
    }
}
