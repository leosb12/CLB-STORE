<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Dominio\ConsultaProductos;
use Clb\Inventario\Puertos\Entrada\PuertoListarProductos;
use Clb\Inventario\Puertos\Entrada\PuertoConsultarProducto;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final readonly class ControladorConsultaProductosHttp
{
    public function __construct(private PuertoListarProductos $listar, private PuertoConsultarProducto $consultar) {}

    public function listar(Request $solicitud): JsonResponse
    {
        $datos = $solicitud->query();
        Validator::make($datos, [
            'página' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'límite' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'búsqueda' => ['sometimes', 'string', 'max:160'],
            'categoría' => ['sometimes', 'string', 'max:100'],
        ], ['integer' => 'El campo :attribute debe ser un entero.', 'min' => 'El campo :attribute es menor que el mínimo.',
            'max' => 'El campo :attribute supera el máximo permitido.', 'string' => 'El campo :attribute debe ser texto.'])->validate();
        if (array_diff(array_keys($datos), ['página', 'límite', 'búsqueda', 'categoría']) !== []) {
            throw ValidationException::withMessages(['solicitud' => ['La consulta contiene parámetros no admitidos.']]);
        }
        $consulta = new ConsultaProductos((int) ($datos['página'] ?? 1), (int) ($datos['límite'] ?? 24),
            trim($datos['búsqueda'] ?? ''), trim($datos['categoría'] ?? ''));
        $resultado = $this->listar->ejecutar($consulta);

        return response()->json([
            'productos' => array_map(RepresentacionProducto::de(...), $resultado->productos),
            'paginación' => ['página' => $consulta->página, 'límite' => $consulta->límite,
                'total' => $resultado->total, 'páginas' => (int) ceil($resultado->total / $consulta->límite)],
            'orden' => 'nombre_asc_identificador_asc',
        ], 200, ['Cache-Control' => 'no-store'], JSON_UNESCAPED_UNICODE);
    }

    public function consultar(string $identificador): JsonResponse
    {
        return response()->json(['producto' => RepresentacionProducto::de($this->consultar->ejecutar($identificador))],
            200, ['Cache-Control' => 'no-store'], JSON_UNESCAPED_UNICODE);
    }
}
