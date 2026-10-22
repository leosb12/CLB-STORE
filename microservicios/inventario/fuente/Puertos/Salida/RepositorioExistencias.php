<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Salida;

use Clb\Inventario\Dominio\{Existencias, OperacionAdministrativa};

interface RepositorioExistencias
{
    public function leer(): array;
    public function resultado(OperacionAdministrativa $operación): ?array;
    public function confirmar(int $revisión, Existencias $existencias, OperacionAdministrativa $operación, array $resultado): bool;
    public function migrar(): int;
}
