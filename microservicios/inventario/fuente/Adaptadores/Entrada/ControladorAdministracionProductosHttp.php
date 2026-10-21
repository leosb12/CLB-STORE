<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Aplicacion\DatosModificacionProducto;
use Clb\Inventario\Dominio\ConsultaProductos;
use Clb\Inventario\Puertos\Entrada\{PuertoModificarProducto, PuertoListarProductos, PuertoConsultarProducto};
use Illuminate\Http\{Request, JsonResponse};
use Illuminate\Support\Facades\Validator;

final readonly class ControladorAdministracionProductosHttp
{
    public function __construct(private PuertoModificarProducto $modificar, private PuertoListarProductos $listar, private PuertoConsultarProducto $consultar) {}

    public function listar(Request $solicitud): JsonResponse
    {
        $datos = Validator::make($solicitud->query(), ['página' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'límite' => ['sometimes', 'integer', 'min:1', 'max:100']], ['integer' => 'El campo :attribute debe ser un entero.',
            'min' => 'El campo :attribute es menor que el mínimo.', 'max' => 'El campo :attribute supera el máximo.'])->validate();
        $consulta = new ConsultaProductos((int) ($datos['página'] ?? 1), (int) ($datos['límite'] ?? 100), incluirInactivos: true);
        $resultado = $this->listar->ejecutar($consulta);
        return response()->json(['productos' => array_map(RepresentacionProducto::de(...), $resultado->productos),
            'paginación' => ['página' => $consulta->página, 'límite' => $consulta->límite, 'total' => $resultado->total,
                'páginas' => (int) ceil($resultado->total / $consulta->límite)]]);
    }

    public function consultar(string $identificador): JsonResponse
    {
        return response()->json(['producto' => RepresentacionProducto::de($this->consultar->ejecutar($identificador, true))]);
    }

    public function modificar(Request $solicitud, string $identificador): JsonResponse
    {
        $datos = $solicitud->all();
        Validator::make($datos, [
            'sku' => ['required', 'string'], 'nombre' => ['required', 'string'],
            'descripción' => ['present', 'string'], 'categoría' => ['required', 'string'],
            'precio' => ['required', 'string'], 'versión_esperada' => ['required', 'integer', 'min:1', 'max:2147483646',
                fn (string $atributo, mixed $valor, \Closure $rechazar) => is_int($valor) ? null : $rechazar('La versión esperada debe ser un entero JSON.')],
            'activo' => ['required', fn (string $atributo, mixed $valor, \Closure $rechazar) => is_bool($valor) ? null : $rechazar('El campo activo debe ser un booleano JSON.')],
        ], ['required' => 'El campo :attribute es obligatorio.', 'string' => 'El campo :attribute debe ser texto.',
            'integer' => 'El campo :attribute debe ser un entero.', 'min' => 'El campo :attribute debe ser positivo.'])->validate();
        if (array_diff(array_keys($datos), ['sku', 'nombre', 'descripción', 'categoría', 'precio', 'activo', 'versión_esperada']) !== []) {
            throw \Illuminate\Validation\ValidationException::withMessages(['solicitud' => ['La solicitud contiene campos no admitidos.']]);
        }
        $producto = $this->modificar->ejecutar(new DatosModificacionProducto($identificador,
            $datos['sku'], $datos['nombre'], $datos['descripción'], $datos['categoría'], $datos['precio'],
            $datos['activo'], (int) $datos['versión_esperada'], $solicitud->header('Idempotency-Key', '')));
        return response()->json(['mensaje' => 'Producto modificado correctamente.', 'producto' => RepresentacionProducto::de($producto)]);
    }
}
