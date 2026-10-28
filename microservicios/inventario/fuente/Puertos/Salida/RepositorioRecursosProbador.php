<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Salida;

interface RepositorioRecursosProbador
{
    public function leer(string $producto): array;

    /** CAS sobre revisión de recursos y versión comercial; todo en el documento del producto. */
    public function guardar(string $producto, int $revisión, int $versión, array $flujo, ?array $publicar = null): bool;

    public function publicado(string $hash): bool;

    public function candidatas(int $ahora): array;
}
