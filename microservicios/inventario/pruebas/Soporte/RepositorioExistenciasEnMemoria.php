<?php

declare(strict_types=1);

namespace Pruebas\Soporte;

use Clb\Inventario\Dominio\{Existencias, OperacionAdministrativa, ConflictoDeIdempotencia};
use Clb\Inventario\Puertos\Salida\RepositorioExistencias;

final class RepositorioExistenciasEnMemoria implements RepositorioExistencias
{
    public Existencias $existencias;
    public int $revisión = 0;
    private array $resultados = [];
    public function __construct() { $this->existencias = new Existencias; }
    public function leer(): array { return [$this->revisión, clone $this->existencias]; }
    public function resultado(OperacionAdministrativa $operación): ?array
    {
        $anterior = $this->resultados[$operación->identificador] ?? null;
        if ($anterior !== null && $anterior[0] !== $operación->huella) throw new ConflictoDeIdempotencia;
        return $anterior[1] ?? null;
    }
    public function confirmar(int $revisión, Existencias $existencias, OperacionAdministrativa $operación, array $resultado): bool
    {
        if ($revisión !== $this->revisión) return false;
        $this->existencias = clone $existencias; $this->revisión++;
        $this->resultados[$operación->identificador] = [$operación->huella, $resultado];
        return true;
    }
    public function migrar(): int { return 0; }
    public function eventos(int $desde, int $límite): array
    {
        return ['total' => count($this->existencias->eventos), 'eventos' => array_slice(array_values($this->existencias->eventos), $desde, $límite)];
    }
}
