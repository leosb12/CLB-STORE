<?php

use Clb\Inventario\Adaptadores\Entrada\ControladorProductosHttp;
use Illuminate\Support\Facades\Route;

Route::middleware(\Clb\Inventario\Adaptadores\Entrada\RestringirAdministracion::class)->group(function () {
    Route::post('/v1/productos', ControladorProductosHttp::class);
    Route::put('/v1/productos/{identificador}', [\Clb\Inventario\Adaptadores\Entrada\ControladorAdministracionProductosHttp::class, 'modificar']);
    Route::get('/v1/productos/administracion', [\Clb\Inventario\Adaptadores\Entrada\ControladorAdministracionProductosHttp::class, 'listar']);
    Route::get('/v1/productos/administracion/{identificador}', [\Clb\Inventario\Adaptadores\Entrada\ControladorAdministracionProductosHttp::class, 'consultar']);
});
Route::get('/v1/productos', [\Clb\Inventario\Adaptadores\Entrada\ControladorConsultaProductosHttp::class, 'listar']);
Route::get('/v1/productos/{identificador}', [\Clb\Inventario\Adaptadores\Entrada\ControladorConsultaProductosHttp::class, 'consultar']);
