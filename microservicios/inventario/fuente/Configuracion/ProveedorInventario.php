<?php

declare(strict_types=1);

namespace Clb\Inventario\Configuracion;

use Clb\Inventario\Adaptadores\Salida\AdaptadorProductosMongoDB;
use Clb\Inventario\Aplicacion\RegistrarProducto;
use Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto;
use Clb\Inventario\Puertos\Salida\RepositorioProductos;
use Clb\Inventario\Adaptadores\Entrada\{AccesoOidc, LlavesIdentidad};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

final class ProveedorInventario extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoGestionarRecursosProbador::class, \Clb\Inventario\Aplicacion\GestionarRecursosProbador::class);
        $this->app->bind(\Clb\Inventario\Puertos\Salida\RepositorioRecursosProbador::class, fn () => new \Clb\Inventario\Adaptadores\Salida\RecursosProbadorMongoDB(DB::connection('mongodb')->getCollection(config('inventario.colección'))));
        $this->app->bind(\Clb\Inventario\Puertos\Salida\AlmacenRecursosProbador::class, function () {
            $local = new \Clb\Inventario\Adaptadores\Salida\ArchivosRecursosProbador(config('recursos_probador.directorio'));
            return config('recursos_probador.archivos_url') === '' ? $local : new \Clb\Inventario\Adaptadores\Salida\ArchivosCompartidos(
                $local, config('recursos_probador.directorio').'/comprobantes-s3', config('recursos_probador.archivos_url'),
                config('recursos_probador.url_token'), config('recursos_probador.secreto'), $this->app->make(\Illuminate\Http\Client\Factory::class));
        });
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoGestionarExistencias::class, \Clb\Inventario\Aplicacion\GestionarExistencias::class);
        // Fase 7: por defecto los puertos de acceso usan tokens de Keycloak; el modo local queda solo para pruebas.
        $this->app->singleton(LlavesIdentidad::class, fn () => new LlavesIdentidad(config('administracion.identidad_jwks')));
        $oidc = fn ($aplicación, array $roles) => new AccesoOidc($aplicación->make(\Illuminate\Http\Request::class),
            $aplicación->make(LlavesIdentidad::class), config('administracion.identidad_emisor'), $roles);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\AccesoInternoInventario::class, fn ($aplicación) => config('administracion.acceso') === 'local'
            ? $aplicación->make(\Clb\Inventario\Adaptadores\Entrada\AccesoInternoLocal::class) : $oidc($aplicación, ['servicio', 'admin']));
        $this->app->bind(\Clb\Inventario\Puertos\Salida\RepositorioExistencias::class, fn () => new \Clb\Inventario\Adaptadores\Salida\AdaptadorExistenciasMongoDB(DB::connection('mongodb')->getCollection(config('inventario.colección'))));
        $this->app->bind(PuertoRegistrarProducto::class, RegistrarProducto::class);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoModificarProducto::class, \Clb\Inventario\Aplicacion\ModificarProducto::class);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\AccesoAdministrativo::class, fn ($aplicación) => config('administracion.acceso') === 'local'
            ? $aplicación->make(\Clb\Inventario\Adaptadores\Entrada\AccesoAdministrativoLocal::class) : $oidc($aplicación, ['admin']));
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoListarProductos::class, \Clb\Inventario\Aplicacion\ListarProductos::class);
        $this->app->bind(\Clb\Inventario\Puertos\Entrada\PuertoConsultarProducto::class, \Clb\Inventario\Aplicacion\ConsultarProducto::class);
        $this->app->bind(RepositorioProductos::class, function () {
            $colección = DB::connection('mongodb')->getCollection(config('inventario.colección'));

            return new AdaptadorProductosMongoDB($colección);
        });
    }
}
