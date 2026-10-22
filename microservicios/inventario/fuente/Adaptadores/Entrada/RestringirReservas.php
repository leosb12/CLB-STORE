<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Puertos\Entrada\AccesoInternoInventario;

final readonly class RestringirReservas
{
    public function __construct(private AccesoInternoInventario $acceso) {}
    public function handle(\Illuminate\Http\Request $solicitud, \Closure $siguiente): \Symfony\Component\HttpFoundation\Response
    {
        $this->acceso->autorizar();
        return $siguiente($solicitud)->header('Cache-Control', 'no-store');
    }
}
