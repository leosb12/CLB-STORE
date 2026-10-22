<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

interface PuertoGestionarExistencias
{
    public function ejecutar(string $tipo, array $datos, string $clave): array;
    public function consultar(string $tipo, string $id = '', bool $administración = false): array;
}
