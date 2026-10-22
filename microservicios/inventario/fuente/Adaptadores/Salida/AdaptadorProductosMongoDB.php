<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Salida;

use Clb\Inventario\Dominio\Producto;
use Clb\Inventario\Dominio\SkuDuplicado;
use Clb\Inventario\Puertos\Salida\RepositorioProductos;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;
use MongoDB\Driver\Exception\BulkWriteException;
use Clb\Inventario\Dominio\{OperacionAdministrativa, ConflictoDeIdempotencia, ConflictoDeVersion, ProductoInexistente, ReglaDeProductoIncumplida};

final readonly class AdaptadorProductosMongoDB implements RepositorioProductos
{
    public function __construct(private Collection $colección) {}

    public function guardar(Producto $producto): void
    {
        // La base resuelve las carreras de SKU mediante un índice único idempotente.
        $this->colección->createIndex(['sku' => 1], ['unique' => true, 'name' => 'clb_sku_unico']);
        try {
            $this->colección->insertOne([
                '_id' => $producto->identificador,
                'identificador' => $producto->identificador,
                'sku' => $producto->sku->valor,
                'nombre' => $producto->nombre,
                'descripción' => $producto->descripción,
                'categoría' => $producto->categoría,
                'precio_centavos' => $producto->precio->centavos,
                'moneda' => 'BOB',
                'activo' => $producto->activo,
                'fecha_creación' => new UTCDateTime($producto->fechaCreación),
                'fecha_actualización' => new UTCDateTime($producto->fechaActualización),
                'versión_sincronización' => $producto->versiónSincronización,
            ]);
        } catch (BulkWriteException $error) {
            foreach ($error->getWriteResult()->getWriteErrors() as $fallo) {
                if ($fallo->getCode() === 11000 && str_contains($fallo->getMessage(), 'clb_sku_unico')) {
                    throw new SkuDuplicado;
                }
            }
            throw $error;
        }
    }

    public function listar(\Clb\Inventario\Dominio\ConsultaProductos $consulta): \Clb\Inventario\Dominio\PaginaProductos
    {
        $filtro = $consulta->incluirInactivos ? ['identificador' => ['$exists' => true]] : ['activo' => true];
        if ($consulta->búsqueda !== '') {
            $filtro['nombre'] = new \MongoDB\BSON\Regex(preg_quote($consulta->búsqueda), 'i');
        }
        if ($consulta->categoría !== '') {
            $filtro['categoría'] = $consulta->categoría;
        }
        $documentos = $this->colección->find($filtro, [
            'sort' => ['nombre' => 1, 'identificador' => 1],
            'skip' => ($consulta->página - 1) * $consulta->límite,
            'limit' => $consulta->límite,
        ]);
        $productos = [];
        foreach ($documentos as $documento) {
            $productos[] = $this->reconstituir($documento);
        }

        return new \Clb\Inventario\Dominio\PaginaProductos($productos, $this->colección->countDocuments($filtro));
    }

    public function buscarPorIdentificador(string $identificador, bool $incluirInactivos = false): ?Producto
    {
        $filtro = ['identificador' => $identificador];
        if (! $incluirInactivos) $filtro['activo'] = true;
        $documento = $this->colección->findOne($filtro);

        return $documento === null ? null : $this->reconstituir($documento);
    }

    public function registrarIdempotente(Producto $producto, OperacionAdministrativa $operación): Producto
    {
        $this->prepararIndices();
        $anterior = $this->resultadoOperacion($operación);
        if ($anterior !== null) return $anterior;
        $instantánea = $this->documento($producto);
        $documento = [...$instantánea,
            'clb_claves_operacion' => [$operación->identificador],
            'clb_resultados_operacion' => [$operación->identificador => ['huella' => $operación->huella, 'producto' => $instantánea]],
        ];
        try {
            $this->colección->insertOne($documento, $this->escrituraDurable());
        } catch (BulkWriteException $error) {
            $resultado = $this->resultadoOperacion($operación);
            if ($resultado !== null) return $resultado;
            $this->traducirDuplicado($error);
        }
        // La primera respuesta y los reintentos tienen la misma precisión BSON.
        return $this->reconstituir($instantánea);
    }

    public function resultadoOperacion(OperacionAdministrativa $operación): ?Producto
    {
        $documento = $this->colección->findOne(['clb_claves_operacion' => $operación->identificador]);
        if ($documento === null) return null;
        $resultado = $documento['clb_resultados_operacion'][$operación->identificador];
        if ($resultado['huella'] !== $operación->huella) throw new ConflictoDeIdempotencia;
        return $this->reconstituir($resultado['producto']);
    }

    public function actualizar(Producto $producto, int $versiónEsperada, OperacionAdministrativa $operación): Producto
    {
        $this->prepararIndices();
        $anterior = $this->resultadoOperacion($operación);
        if ($anterior !== null) return $anterior;
        $documento = $this->documento($producto);
        unset($documento['_id']);
        $versión = $versiónEsperada === 1
            ? ['$or' => [['versión_sincronización' => 1], ['versión_sincronización' => ['$exists' => false]]]]
            : ['versión_sincronización' => $versiónEsperada];
        $filtro = [
            'identificador' => $producto->identificador,
            'clb_claves_operacion' => ['$ne' => $operación->identificador],
            '$expr' => ['$lt' => [['$size' => ['$ifNull' => ['$clb_claves_operacion', []]]], 256]],
            ...$versión,
        ];
        try {
            // Estado, versión y comprobante se confirman en una sola escritura.
            $resultado = $this->colección->updateOne($filtro, [
                '$set' => [...$documento, 'clb_resultados_operacion.'.$operación->identificador => ['huella' => $operación->huella, 'producto' => $documento]],
                '$addToSet' => ['clb_claves_operacion' => $operación->identificador],
            ], $this->escrituraDurable());
        } catch (BulkWriteException $error) {
            $anterior = $this->resultadoOperacion($operación);
            if ($anterior !== null) return $anterior;
            $this->traducirDuplicado($error);
        }
        if ($resultado->getMatchedCount() === 1) return $this->reconstituir($documento);
        $anterior = $this->resultadoOperacion($operación);
        if ($anterior !== null) return $anterior;
        $actual = $this->buscarPorIdentificador($producto->identificador, true) ?? throw new ProductoInexistente;
        if ($actual->versiónSincronización !== $versiónEsperada) throw new ConflictoDeVersion($actual);
        // No se descartan comprobantes: se detiene antes del límite BSON de 16 MiB.
        throw new ReglaDeProductoIncumplida('operaciones', 'Este producto alcanzó el límite local de 256 operaciones persistentes. Requiere revisión técnica; no se borró el historial.');
    }

    private function prepararIndices(): void
    {
        $this->colección->createIndex(['sku' => 1], ['unique' => true, 'name' => 'clb_sku_unico']);
        $this->colección->createIndex(['clb_claves_operacion' => 1], ['unique' => true, 'sparse' => true, 'name' => 'clb_operacion_unica']);
    }

    private function escrituraDurable(): array
    {
        return ['writeConcern' => new \MongoDB\Driver\WriteConcern(1, 10000, true)];
    }

    private function traducirDuplicado(BulkWriteException $error): never
    {
        foreach ($error->getWriteResult()->getWriteErrors() as $fallo) {
            if ($fallo->getCode() === 11000 && str_contains($fallo->getMessage(), 'clb_sku_unico')) throw new SkuDuplicado;
        }
        throw $error;
    }

    private function documento(Producto $producto): array
    {
        return [
            '_id' => $producto->identificador, 'identificador' => $producto->identificador,
            'sku' => $producto->sku->valor, 'nombre' => $producto->nombre, 'descripción' => $producto->descripción,
            'categoría' => $producto->categoría, 'precio_centavos' => $producto->precio->centavos,
            'moneda' => 'BOB', 'activo' => $producto->activo,
            'fecha_creación' => new UTCDateTime($producto->fechaCreación),
            'fecha_actualización' => new UTCDateTime($producto->fechaActualización),
            'versión_sincronización' => $producto->versiónSincronización,
        ];
    }

    private function reconstituir(mixed $documento): Producto
    {
        $centavos = (int) $documento['precio_centavos'];
        $precio = intdiv($centavos, 100).'.'.str_pad((string) ($centavos % 100), 2, '0', STR_PAD_LEFT);

        // Lectura compatible con productos registrados antes de la fase 3.
        return new Producto(
            $documento['identificador'], new \Clb\Inventario\Dominio\CodigoSku($documento['sku']),
            $documento['nombre'], $documento['descripción'], $documento['categoría'],
            new \Clb\Inventario\Dominio\PrecioEnBolivianos($precio), $documento['activo'],
            $documento['fecha_creación']->toDateTimeImmutable(),
            ($documento['fecha_actualización'] ?? $documento['fecha_creación'])->toDateTimeImmutable(),
            (int) ($documento['versión_sincronización'] ?? 1),
        );
    }
}
