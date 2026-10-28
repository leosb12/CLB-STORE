<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Salida;

interface AlmacenRecursosProbador
{
    public function guardar(string $binario, string $tipo): array;

    public function leer(string $hash, string $tipo): string;

    public function publicar(string $hash): void;
}
