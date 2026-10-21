<?php

declare(strict_types=1);

namespace Clb\Inventario\Configuracion;

use Clb\Inventario\Adaptadores\Salida\AdaptadorProductosMongoDB;
use Clb\Inventario\Aplicacion\RegistrarProducto;
use Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto;
use Clb\Inventario\Puertos\Salida\RepositorioProductos;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

final class ProveedorInventario extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PuertoRegistrarProducto::class, RegistrarProducto::class);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoModificarProducto::class, \Clb\Inventario\Aplicacion\ModificarProducto::class);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\AccesoAdministrativo::class, \Clb\Inventario\Adaptadores\Entrada\AccesoAdministrativoLocal::class);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoListarProductos::class, \Clb\Inventario\Aplicacion\ListarProductos::class);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoConsultarProducto::class, \Clb\Inventario\Aplicacion\ConsultarProducto::class);
        $this->app->bind(RepositorioProductos::class, function () {
            $colección = DB::connection('mongodb')->getCollection(config('inventario.colección'));

            return new AdaptadorProductosMongoDB($colección);
        });
    }
}
