<?php

declare(strict_types=1);

namespace Clb\Inventario\Aplicacion;

use Clb\Inventario\Dominio\{Existencias, OperacionAdministrativa, ErrorDeExistencias, ProductoInexistente};
use Clb\Inventario\Puertos\Entrada\PuertoGestionarExistencias;
use Clb\Inventario\Puertos\Salida\{RepositorioExistencias, RepositorioProductos};

final readonly class GestionarExistencias implements PuertoGestionarExistencias
{
    public const CURSOR_INVÁLIDO = 'desde debe ser un entero no negativo y límite un entero de 1 a 100.';

    public function __construct(private RepositorioExistencias $repositorio, private RepositorioProductos $productos) {}

    public function ejecutar(string $tipo, array $datos, string $clave): array
    {
        $clave = Existencias::validarUuid($clave);
        // JSON no atribuye significado al orden de las propiedades. Las líneas
        // de una reserva tampoco tienen prioridad: se comparan por variante.
        if ($tipo === 'RESERVAR' && is_array($datos['líneas'] ?? null) && array_is_list($datos['líneas'])) {
            usort($datos['líneas'], fn ($a, $b) => (string) (is_array($a) ? ($a['identificador_variante'] ?? '') : '') <=> (string) (is_array($b) ? ($b['identificador_variante'] ?? '') : ''));
        }
        $datos = $this->ordenarPropiedades($datos);
        $operación = new OperacionAdministrativa($clave, $tipo, $datos);
        for ($intento = 0; $intento < 20; $intento++) {
            $anterior = $this->repositorio->resultado($operación);
            if ($anterior !== null) return $anterior;
            [$revisión, $existencias] = $this->repositorio->leer();
            if ($tipo === 'CREAR_VARIANTE') {
                $this->productos->buscarPorIdentificador($datos['identificador_producto'], true) ?? throw new ProductoInexistente;
            }
            if ($tipo === 'RESERVAR') {
                if (!is_array($datos['líneas'] ?? null)) throw new ErrorDeExistencias('La reserva requiere líneas válidas.');
                foreach ($datos['líneas'] ?? [] as $línea) {
                    if (!is_array($línea)) throw new ErrorDeExistencias('Línea de reserva inválida.');
                    $variante = $existencias->variante((string) ($línea['identificador_variante'] ?? ''));
                    $this->productos->buscarPorIdentificador($variante['identificador_producto']) ?? throw new ErrorDeExistencias('El producto de la variante no está activo.', 409);
                }
            }
            try {
                $resultado = $existencias->ejecutar($tipo, $datos, $clave, (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'));
            } catch (\Throwable $error) {
                // Otra solicitud con la misma clave pudo confirmar entre las dos lecturas.
                $anterior = $this->repositorio->resultado($operación);
                if ($anterior !== null) return $anterior;
                throw $error;
            }
            if ($this->repositorio->confirmar($revisión, $existencias, $operación, $resultado)) return $resultado;
        }
        throw new ErrorDeExistencias('Inventario está ocupado. Reintenta con la misma clave.', 503);
    }

    private function ordenarPropiedades(array $datos): array
    {
        if (!array_is_list($datos)) ksort($datos);
        foreach ($datos as &$valor) if (is_array($valor)) $valor = $this->ordenarPropiedades($valor);
        unset($valor);
        return $datos;
    }

    public function eventosDesde(int $desde, int $límite): array
    {
        if ($desde < 0 || $límite < 1 || $límite > 100) throw new ErrorDeExistencias(self::CURSOR_INVÁLIDO);
        ['total' => $total, 'eventos' => $eventos] = $this->repositorio->eventos($desde, $límite);
        // ponytail: el cursor es una posición; un registro recreado se detecta solo si desde supera el total.
        // Si hiciera falta detectar cualquier recreación, agregar un identificador de registro al agregado.
        if ($desde > $total) throw new ErrorDeExistencias('El cursor supera el registro de eventos; el consumidor debe reiniciar desde 0.', 409);
        return ['eventos' => $eventos, 'siguiente' => $desde + count($eventos)];
    }

    public function consultar(string $tipo, string $id = '', bool $administración = false): array
    {
        [, $existencias] = $this->repositorio->leer();
        if ($tipo === 'EVENTOS') return ['eventos' => array_values($existencias->eventos)];
        if ($tipo === 'RESERVA') return ['reserva' => $existencias->reserva($id)];
        if ($tipo === 'VARIANTES') {
            $this->productos->buscarPorIdentificador($id, $administración) ?? throw new ProductoInexistente;
            $variantes = [];
            foreach ($existencias->variantes as $varianteId => $variante) {
                if ($variante['identificador_producto'] === $id && ($administración || $variante['activo'])) $variantes[] = $existencias->pública($varianteId);
            }
            usort($variantes, fn ($a, $b) => [$a['talla'], $a['color'], $a['sku']] <=> [$b['talla'], $b['color'], $b['sku']]);
            return ['variantes' => $variantes];
        }
        $variante = $existencias->variante($id);
        $this->productos->buscarPorIdentificador($variante['identificador_producto'], $administración) ?? throw new ProductoInexistente;
        if (!$administración && !$variante['activo']) throw new ErrorDeExistencias('La variante no está activa.', 404);
        if ($tipo === 'MOVIMIENTOS') return ['movimientos' => $variante['movimientos']];
        return ['variante' => $existencias->pública($id)];
    }
}
