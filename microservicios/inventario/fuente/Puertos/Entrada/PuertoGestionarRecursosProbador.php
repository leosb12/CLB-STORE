<?php

declare(strict_types=1);

namespace Clb\Inventario\Puertos\Entrada;

interface PuertoGestionarRecursosProbador
{
    public function cargar(string $id, string $clave, int $versión, string $color, string $binario): array;

    public function consultar(string $id, string $trabajo): array;

    public function reclamar(int $ahora): ?array;

    public function original(string $id, string $trabajo, string $reclamo): string;

    public function finalizar(string $id, string $trabajo, string $reclamo, array $datos, ?string $textura, ?string $maestro): array;

    public function previsualizar(string $id, string $trabajo): string;

    public function publicar(string $id, string $trabajo, string $clave, int $versión): array;

    public function publico(string $hash): string;
}
