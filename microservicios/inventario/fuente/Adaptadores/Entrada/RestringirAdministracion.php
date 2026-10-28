<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Puertos\Entrada\AccesoAdministrativo;
use Illuminate\Http\Request;

final readonly class RestringirAdministracion
{
    public function __construct(private AccesoAdministrativo $acceso) {}

    public function handle(Request $solicitud, \Closure $siguiente): mixed
    {
        $this->acceso->autorizar();
        $respuesta = $siguiente($solicitud);
        $respuesta->headers->set('Cache-Control', 'no-store');
        if (config('administracion.acceso') === 'local') $respuesta->headers->set('X-CLB-Administracion', 'SOLO-LOCAL-NO-APTA-PARA-PRODUCCION');
        return $respuesta;
    }
}
