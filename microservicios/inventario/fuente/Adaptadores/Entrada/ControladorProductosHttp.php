<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Aplicacion\DatosRegistroProducto;
use Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final readonly class ControladorProductosHttp
{
    public function __construct(private PuertoRegistrarProducto $registrarProducto) {}

    public function __invoke(Request $solicitud): JsonResponse
    {
        $datos = $solicitud->all();
        Validator::make($datos, [
            'sku' => ['required', 'string'],
            'nombre' => ['required', 'string'],
            'descripción' => ['sometimes', 'string'],
            'categoría' => ['required', 'string'],
            'precio' => ['required', 'string'],
            'activo' => ['sometimes', fn (string $atributo, mixed $valor, \Closure $rechazar) => is_bool($valor) ? null : $rechazar('El campo activo debe ser un booleano JSON.')],
        ], [
            'required' => 'El campo :attribute es obligatorio.',
            'string' => 'El campo :attribute debe ser texto.',
            'precio.string' => 'El precio debe enviarse como texto decimal, por ejemplo "129.90".',
        ])->validate();
        $desconocidos = array_diff(array_keys($datos), ['sku', 'nombre', 'descripción', 'categoría', 'precio', 'activo']);
        if ($desconocidos !== []) {
            throw ValidationException::withMessages(['solicitud' => ['La solicitud contiene campos no admitidos.']]);
        }
        $producto = $this->registrarProducto->ejecutar(new DatosRegistroProducto(
            $datos['sku'], $datos['nombre'], $datos['descripción'] ?? '',
            $datos['categoría'], $datos['precio'], $datos['activo'] ?? true,
            $solicitud->header('Idempotency-Key', ''),
        ));

        return response()->json([
            'mensaje' => 'Producto registrado correctamente.',
            'producto' => RepresentacionProducto::de($producto),
        ], 201, [], JSON_UNESCAPED_UNICODE);
    }
}
