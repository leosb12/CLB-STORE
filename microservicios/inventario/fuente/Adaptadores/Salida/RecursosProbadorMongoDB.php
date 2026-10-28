<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Salida;

use Clb\Inventario\Dominio\ErrorDeRecurso;
use Clb\Inventario\Puertos\Salida\RepositorioRecursosProbador;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;
use MongoDB\Driver\WriteConcern;

final readonly class RecursosProbadorMongoDB implements RepositorioRecursosProbador
{
    public function __construct(private Collection $colección) {}

    public function leer(string $producto): array
    {
        $p = $this->colección->findOne(['identificador' => $producto]);
        if ($p === null) {
            throw new ErrorDeRecurso('Producto inexistente.', 404);
        }

        return ['version' => (int) ($p['versión_sincronización'] ?? 1), 'categoria' => $p['categoría'],
            'flujo' => isset($p['clb_recursos']) ? json_decode(json_encode($p['clb_recursos'], JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR) : null];
    }

    public function guardar(string $producto, int $revisión, int $versión, array $flujo, ?array $publicar = null): bool
    {
        $filtro = ['identificador' => $producto, '$and' => [
            ['$or' => [['versión_sincronización' => $versión], ...($versión === 1 ? [['versión_sincronización' => ['$exists' => false]]] : [])]],
            ['$or' => [['clb_recursos.revision' => $revisión], ...($revisión === 0 ? [['clb_recursos' => ['$exists' => false]]] : [])]]]];
        $flujo['revision'] = $revisión + 1;
        $cambios = ['clb_recursos' => $flujo];
        if ($publicar !== null) {
            $cambios = [...$cambios, 'recurso_probador' => $publicar, 'versión_sincronización' => $versión + 1, 'fecha_actualización' => new UTCDateTime];
        }

        return $this->colección->updateOne($filtro, ['$set' => $cambios], ['writeConcern' => new WriteConcern(1, 10000, true)])->getMatchedCount() === 1;
    }

    public function publicado(string $hash): bool
    {
        return $this->colección->findOne(['identificador' => ['$exists' => true], 'clb_recursos.publicados' => $hash]) !== null;
    }

    public function candidatas(int $ahora): array
    {
        return array_map(fn ($p) => $p['identificador'], iterator_to_array($this->colección->find(
            ['identificador' => ['$exists' => true], 'clb_recursos.pendiente' => true, 'clb_recursos.hasta' => ['$lte' => $ahora]],
            ['projection' => ['identificador' => 1], 'limit' => 10, 'sort' => ['clb_recursos.hasta' => 1]]), false));
    }
}
