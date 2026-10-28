<?php

use Clb\Inventario\Dominio\ReglaDeProductoIncumplida;
use Clb\Inventario\Dominio\SkuDuplicado;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use MongoDB\Driver\Exception\Exception as ErrorMongoDB;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(api: __DIR__.'/../rutas/api.php', then: function (): void {
        \Illuminate\Support\Facades\Route::get('/salud', \Clb\Inventario\Adaptadores\Entrada\ControladorSaludHttp::class);
    })
    ->withCommands([\Clb\Inventario\Adaptadores\Entrada\CargarCatalogoDemostracion::class, \Clb\Inventario\Adaptadores\Entrada\MigrarVariantes::class])
    ->withMiddleware(function (Middleware $intermediarios): void {
        $intermediarios->remove([
            TrimStrings::class,
            ConvertEmptyStringsToNull::class,
        ]);
    })
    ->withExceptions(function (Exceptions $excepciones): void {
        $excepciones->render(function (\Clb\Inventario\Dominio\ErrorDeRecurso $error) {
            return response()->json(['mensaje'=>$error->getMessage(), 'código'=>$error->código], $error->estado);
        });
        $excepciones->render(function (\Clb\Inventario\Dominio\ErrorDeExistencias $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'código' => $error->estado === 409 ? 'CONFLICTO_EXISTENCIAS' : 'EXISTENCIAS_INVALIDAS', 'variante_actual' => $error->actual], $error->estado);
        });
        $excepciones->dontReport([ReglaDeProductoIncumplida::class, SkuDuplicado::class]);
        $excepciones->shouldRenderJsonWhen(fn (Request $solicitud, Throwable $error): bool => true);
        $excepciones->render(function (\Clb\Inventario\Dominio\IdentidadNoDisponible $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'código' => 'IDENTIDAD_NO_DISPONIBLE'], 503);
        });
        $excepciones->render(function (\Clb\Inventario\Dominio\NoAutenticado $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'código' => 'NO_AUTENTICADO'], 401);
        });
        $excepciones->render(function (\Clb\Inventario\Dominio\AdministracionNoAutorizada $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'código' => 'ADMINISTRACION_NO_AUTORIZADA'], 403);
        });
        $excepciones->render(function (\Clb\Inventario\Dominio\ConflictoDeVersion $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'código' => 'CONFLICTO_VERSION',
                'producto_actual' => \Clb\Inventario\Adaptadores\Entrada\RepresentacionProducto::de($error->actual)], 409);
        });
        $excepciones->render(function (\Clb\Inventario\Dominio\ConflictoDeIdempotencia $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'código' => 'CONFLICTO_IDEMPOTENCIA'], 409);
        });
        $excepciones->render(function (\Clb\Inventario\Dominio\ProductoInexistente $error) {
            return response()->json(['mensaje' => $error->getMessage()], 404);
        });
        $excepciones->render(function (ValidationException $error) {
            return response()->json(['mensaje' => 'Los datos enviados no son válidos.', 'errores' => $error->errors()], 422);
        });
        $excepciones->render(function (ReglaDeProductoIncumplida $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'errores' => [$error->campo => [$error->getMessage()]]], 422);
        });
        $excepciones->render(function (SkuDuplicado $error) {
            return response()->json(['mensaje' => $error->getMessage(), 'errores' => ['sku' => [$error->getMessage()]]], 409);
        });
        $excepciones->render(function (ErrorMongoDB $error) {
            return response()->json(['mensaje' => 'No se pudo acceder al almacenamiento de Inventario.'], 503);
        });
        $excepciones->render(function (HttpExceptionInterface $error) {
            $estado = $error->getStatusCode();
            $mensaje = match ($estado) {
                400 => 'La solicitud no es válida.',
                404 => 'La ruta solicitada no existe.',
                405 => 'El método HTTP no está permitido para esta ruta.',
                413 => 'La solicitud supera el tamaño permitido.',
                default => 'No se pudo procesar la solicitud.',
            };

            return response()->json(['mensaje' => $mensaje], $estado, $error->getHeaders());
        });
        $excepciones->render(function (Throwable $error) {
            return response()->json(['mensaje' => 'Ocurrió un error interno al procesar la solicitud.'], 500);
        });
    })->create()->useAppPath(dirname(__DIR__).'/fuente');
