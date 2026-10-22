<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Salida;

use Clb\Inventario\Dominio\{Existencias, OperacionAdministrativa, ConflictoDeIdempotencia, ErrorDeExistencias};
use Clb\Inventario\Puertos\Salida\RepositorioExistencias;
use MongoDB\Collection;
use MongoDB\Driver\Exception\BulkWriteException;

final readonly class AdaptadorExistenciasMongoDB implements RepositorioExistencias
{
    public const IDENTIFICADOR = 'clb_existencias';

    public function __construct(private Collection $colección) {}

    public function leer(): array
    {
        $documento = $this->colección->findOne(['_id' => self::IDENTIFICADOR], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);
        if ($documento === null) return [0, new Existencias];
        return [$documento['revisión'], new Existencias($documento['variantes'], $documento['reservas'], $documento['eventos'])];
    }

    public function resultado(OperacionAdministrativa $operación): ?array
    {
        $documento = $this->colección->findOne(['clb_claves_operacion' => $operación->identificador], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);
        if ($documento === null) return null;
        $resultado = $documento['clb_resultados_operacion'][$operación->identificador];
        if ($resultado['huella'] !== $operación->huella) throw new ConflictoDeIdempotencia;
        return $resultado['resultado'];
    }

    public function confirmar(int $revisión, Existencias $existencias, OperacionAdministrativa $operación, array $resultado): bool
    {
        $this->colección->createIndex(['clb_claves_operacion' => 1], ['unique' => true, 'sparse' => true, 'name' => 'clb_operacion_unica']);
        $this->colección->createIndex(['clb_skus_variantes' => 1], ['unique' => true, 'sparse' => true, 'name' => 'clb_sku_variante_unico']);
        $cambios = ['variantes' => (object) $existencias->variantes, 'reservas' => (object) $existencias->reservas,
            'eventos' => $existencias->eventos, 'clb_skus_variantes' => array_column($existencias->variantes, 'sku')];
        $previo = $this->colección->findOne(['_id' => self::IDENTIFICADOR], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);
        // El margen se comprueba con BSON real, incluyendo todos los comprobantes conservados.
        $documento = $previo ?? ['_id' => self::IDENTIFICADOR];
        $documento = [...$documento, ...$cambios];
        $documento['clb_resultados_operacion'] = (array) ($documento['clb_resultados_operacion'] ?? []);
        $documento['clb_resultados_operacion'][$operación->identificador] = ['huella' => $operación->huella, 'resultado' => $resultado];
        $margenTerminaciones = 0;
        foreach ($existencias->reservas as $reserva) if ($reserva['estado'] === 'ACTIVA') $margenTerminaciones += 4096 * count($reserva['líneas']) + 2048;
        if (strlen((string) \MongoDB\BSON\Document::fromPHP($documento)) + $margenTerminaciones > 8 * 1024 * 1024) throw new ErrorDeExistencias('El agregado local alcanzó 8 MiB, incluyendo margen para terminar reservas. Requiere partición técnica sin borrar comprobantes ni historial.');
        $escritura = ['writeConcern' => new \MongoDB\Driver\WriteConcern(1, 10000, true)];
        try {
            if ($revisión === 0) {
                $this->colección->insertOne([...$cambios, '_id' => self::IDENTIFICADOR, 'revisión' => 1,
                    'clb_claves_operacion' => [$operación->identificador],
                    'clb_resultados_operacion' => [$operación->identificador => ['huella' => $operación->huella, 'resultado' => $resultado]],
                ], $escritura);
                return true;
            }
            $respuesta = $this->colección->updateOne(['_id' => self::IDENTIFICADOR, 'revisión' => $revisión,
                'clb_claves_operacion' => ['$ne' => $operación->identificador]], [
                '$set' => [...$cambios, 'clb_resultados_operacion.'.$operación->identificador => ['huella' => $operación->huella, 'resultado' => $resultado]],
                '$inc' => ['revisión' => 1], '$addToSet' => ['clb_claves_operacion' => $operación->identificador],
            ], $escritura);
            return $respuesta->getMatchedCount() === 1;
        } catch (BulkWriteException $error) {
            foreach ($error->getWriteResult()->getWriteErrors() as $fallo) if ($fallo->getCode() === 11000) {
                $this->resultado($operación); // Detecta también claves usadas por productos.
                return false;
            }
            throw $error;
        }
    }

    public function migrar(): int
    {
        // SKU continúa siendo la referencia comercial del producto. No se infieren atributos ni saldos.
        return $this->colección->updateMany(['identificador' => ['$exists' => true], 'clb_esquema_variantes' => ['$exists' => false]],
            ['$set' => ['clb_esquema_variantes' => 1, 'clb_sku_producto' => true]],
            ['writeConcern' => new \MongoDB\Driver\WriteConcern(1, 10000, true)])->getModifiedCount();
    }
}
