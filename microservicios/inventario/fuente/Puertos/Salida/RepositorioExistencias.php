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
    /** Lee solo el tramo pedido del registro de eventos y su total, sin cargar el agregado completo. */
    public function eventos(int $desde, int $límite): array;
}
