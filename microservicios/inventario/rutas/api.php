<?php

use Clb\Inventario\Adaptadores\Entrada\ControladorProductosHttp;
use Illuminate\Support\Facades\Route;
use Clb\Inventario\Adaptadores\Entrada\ControladorExistenciasHttp as ExistenciasHttp;

Route::middleware(\Clb\Inventario\Adaptadores\Entrada\RestringirAdministracion::class)->group(function () {
    Route::post('/v1/productos/{id}/variantes', [ExistenciasHttp::class, 'crear']);
    Route::put('/v1/variantes/{id}', [ExistenciasHttp::class, 'modificar']);
    Route::post('/v1/variantes/{id}/movimientos', [ExistenciasHttp::class, 'movimiento']);
    Route::put('/v1/variantes/{id}/minimo', [ExistenciasHttp::class, 'mínimo']);
    Route::get('/v1/variantes/{id}/movimientos', [ExistenciasHttp::class, 'movimientos']);
    Route::get('/v1/administracion/productos/{id}/variantes', [ExistenciasHttp::class, 'variantesAdministrativas']);
    Route::get('/v1/administracion/variantes/{id}', [ExistenciasHttp::class, 'varianteAdministrativa']);
});
Route::middleware(\Clb\Inventario\Adaptadores\Entrada\RestringirReservas::class)->group(function () {
    Route::post('/v1/interno/reservas', [ExistenciasHttp::class, 'reservar']);
    Route::get('/v1/interno/reservas/{id}', [ExistenciasHttp::class, 'reserva']);
    Route::post('/v1/interno/reservas/{id}/consumir', [ExistenciasHttp::class, 'consumir']);
    Route::post('/v1/interno/reservas/{id}/liberar', [ExistenciasHttp::class, 'liberar']);
    Route::get('/v1/interno/eventos', [ExistenciasHttp::class, 'eventos']);
});
Route::get('/v1/productos/{id}/variantes', [ExistenciasHttp::class, 'variantes']);
Route::get('/v1/variantes/{id}', [ExistenciasHttp::class, 'variante']);
Route::get('/v1/variantes/{id}/existencias', [ExistenciasHttp::class, 'variante']);

Route::middleware(\Clb\Inventario\Adaptadores\Entrada\RestringirAdministracion::class)->group(function () {
    Route::post('/v1/productos', ControladorProductosHttp::class);
    Route::put('/v1/productos/{identificador}', [\Clb\Inventario\Adaptadores\Entrada\ControladorAdministracionProductosHttp::class, 'modificar']);
    Route::get('/v1/productos/administracion', [\Clb\Inventario\Adaptadores\Entrada\ControladorAdministracionProductosHttp::class, 'listar']);
    Route::get('/v1/productos/administracion/{identificador}', [\Clb\Inventario\Adaptadores\Entrada\ControladorAdministracionProductosHttp::class, 'consultar']);
});
Route::get('/v1/productos', [\Clb\Inventario\Adaptadores\Entrada\ControladorConsultaProductosHttp::class, 'listar']);
Route::get('/v1/productos/{identificador}', [\Clb\Inventario\Adaptadores\Entrada\ControladorConsultaProductosHttp::class, 'consultar']);

// Preparación fotográfica: los middleware existentes verifican identidad y rol en el servicio.
Route::middleware(\Clb\Inventario\Adaptadores\Entrada\RestringirAdministracion::class)->group(function () {
    $c=\Clb\Inventario\Adaptadores\Entrada\ControladorRecursosProbadorHttp::class;
    Route::get('/v1/administracion/recursos-probador/capacidades',[$c,'capacidades']);
    Route::post('/v1/productos/{id}/recursos-probador',[$c,'cargar']);
    Route::get('/v1/productos/{id}/recursos-probador/{trabajo}',[$c,'consultar']);
    Route::get('/v1/productos/{id}/recursos-probador/{trabajo}/previsualizacion',[$c,'previsualizar']);
    Route::post('/v1/productos/{id}/recursos-probador/{trabajo}/publicar',[$c,'publicar']);
});
Route::middleware(\Clb\Inventario\Adaptadores\Entrada\RestringirReservas::class)->group(function () {
    $c=\Clb\Inventario\Adaptadores\Entrada\ControladorRecursosProbadorHttp::class;
    Route::post('/v1/interno/recursos-probador/reclamar',[$c,'reclamar']);
    Route::get('/v1/interno/recursos-probador/{id}/{trabajo}/original',[$c,'original']);
    Route::post('/v1/interno/recursos-probador/{id}/{trabajo}/resultado',[$c,'finalizar']);
});
Route::get('/v1/recursos-probador/{hash}.png',[\Clb\Inventario\Adaptadores\Entrada\ControladorRecursosProbadorHttp::class,'publico'])->where('hash','[a-f0-9]{64}');
