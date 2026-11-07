<?php

declare(strict_types=1);

namespace Clb\Inventario\Dominio;

/** Agregado local: permite reservar varias variantes de forma indivisible en MongoDB standalone. */
final class Existencias
{
    public function __construct(public array $variantes = [], public array $reservas = [], public array $eventos = []) {}

    public static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 15) | 64);
        $bytes[8] = chr((ord($bytes[8]) & 63) | 128);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    public function variante(string $id): array
    {
        return $this->variantes[$id] ?? throw new ErrorDeExistencias('La variante no existe.', 404);
    }

    public function reserva(string $id): array
    {
        return $this->reservas[$id] ?? throw new ErrorDeExistencias('La reserva no existe.', 404);
    }

    public function ejecutar(string $tipo, array $datos, string $operación, string $fecha): array
    {
        $antes = [$this->variantes, $this->reservas, $this->eventos];
        try {
            return $this->aplicar($tipo, $datos, $operación, $fecha);
        } catch (\Throwable $error) {
            [$this->variantes, $this->reservas, $this->eventos] = $antes;
            throw $error;
        }
    }

    private function aplicar(string $tipo, array $datos, string $operación, string $fecha): array
    {
        if ($tipo === 'CREAR_VARIANTE') {
            $id = self::validarUuid($datos['identificador'] ?? null);
            if (isset($this->variantes[$id])) throw new ErrorDeExistencias('El UUID de variante ya existe.', 409);
            $variante = $this->identidad($datos) + [
                'identificador' => $id, 'identificador_producto' => $datos['identificador_producto'],
                'fecha_creación' => $fecha, 'fecha_actualización' => $fecha, 'versión_sincronización' => 1,
                'física' => 0, 'reservada' => 0, 'disponible' => 0, 'mínimo' => 0,
                'movimientos' => [], 'operaciones' => 1,
            ];
            $this->comprobarSku($variante['sku']);
            $this->variantes[$id] = $variante;
            return ['variante' => $this->pública($id)];
        }
        if ($tipo === 'RESERVAR') return $this->reservar($datos, $operación, $fecha);
        if (in_array($tipo, ['CONSUMIR_RESERVA', 'LIBERAR_RESERVA'], true)) return $this->terminarReserva($tipo, $datos, $operación, $fecha);

        $id = self::validarUuid($datos['identificador_variante'] ?? null);
        $variante = $this->variante($id);
        $this->versión($variante, $datos['versión_esperada'] ?? null);
        $antes = $variante['disponible'];
        if ($tipo === 'MODIFICAR_VARIANTE') {
            $identidad = $this->identidad($datos);
            $this->comprobarSku($identidad['sku'], $id);
            if ($variante['movimientos'] || $variante['reservada'] > 0) {
                foreach (['sku', 'talla', 'color'] as $campo) {
                    if ($identidad[$campo] !== $variante[$campo]) throw new ErrorDeExistencias('Una variante con movimientos o reservas conserva su SKU, talla y color para auditoría.', 409, $this->pública($id));
                }
            }
            if (!$identidad['activo'] && $variante['reservada'] > 0) throw new ErrorDeExistencias('No se puede desactivar una variante con reservas activas.', 409);
            $variante = [...$variante, ...$identidad];
        } elseif ($tipo === 'CONFIGURAR_MINIMO') {
            $variante['mínimo'] = self::cantidad($datos['mínimo'] ?? null, true);
        } elseif ($tipo === 'REGISTRAR_MOVIMIENTO') {
            $cantidad = self::cantidad($datos['cantidad'] ?? null);
            $clase = $datos['tipo'] ?? '';
            $sentido = $datos['sentido'] ?? null;
            if (!in_array($clase, ['ENTRADA', 'SALIDA', 'AJUSTE'], true)) throw new ErrorDeExistencias('Tipo de movimiento inválido.');
            if ($clase === 'AJUSTE' && !in_array($sentido, ['INCREMENTO', 'DISMINUCION'], true)) throw new ErrorDeExistencias('El ajuste requiere sentido INCREMENTO o DISMINUCION.');
            if ($clase !== 'AJUSTE' && $sentido !== null) throw new ErrorDeExistencias('Solo un ajuste admite sentido.');
            $motivo = self::texto($datos['motivo'] ?? null, 'motivo', 500);
            $incremento = $clase === 'ENTRADA' || ($clase === 'AJUSTE' && $sentido === 'INCREMENTO');
            $variante['física'] += $incremento ? $cantidad : -$cantidad;
            $this->saldo($variante);
            $variante['movimientos'][] = $this->movimiento($id, $clase, $cantidad, $motivo, $operación, $fecha, $variante['versión_sincronización'] + 1, $sentido);
        } else throw new ErrorDeExistencias('Operación de existencias desconocida.');
        $this->guardarCambio($id, $variante, $fecha, $antes, $operación);
        return ['variante' => $this->pública($id)];
    }

    public function pública(string $id): array
    {
        $variante = $this->variante($id);
        unset($variante['movimientos'], $variante['operaciones']);
        $variante['stock_bajo'] = $variante['disponible'] <= $variante['mínimo'];
        $variante['agotado'] = $variante['disponible'] === 0;
        return $variante;
    }

    private function identidad(array $datos): array
    {
        $sku = new CodigoSku(self::texto($datos['sku'] ?? null, 'sku', 64));
        if (!is_bool($datos['activo'] ?? null)) throw new ErrorDeExistencias('activo debe ser booleano.');
        return ['sku' => $sku->valor, 'talla' => self::texto($datos['talla'] ?? null, 'talla', 32),
            'color' => self::texto($datos['color'] ?? null, 'color', 80), 'activo' => $datos['activo']];
    }

    private function comprobarSku(string $sku, ?string $excepto = null): void
    {
        foreach ($this->variantes as $id => $variante) if ($id !== $excepto && $variante['sku'] === $sku) throw new SkuDuplicado;
    }

    private function versión(array $variante, mixed $esperada): void
    {
        if (!is_int($esperada) || $esperada < 1) throw new ErrorDeExistencias('versión_esperada debe ser un entero positivo.');
        if ($variante['versión_sincronización'] !== $esperada) {
            throw new ErrorDeExistencias('Conflicto de versión. Revisa el estado actual antes de preparar otra operación.', 409, $this->pública($variante['identificador']));
        }
    }

    private function saldo(array &$variante): void
    {
        $variante['disponible'] = $variante['física'] - $variante['reservada'];
        if ($variante['física'] < 0 || $variante['reservada'] < 0 || $variante['disponible'] < 0 || $variante['física'] > 1_000_000_000) {
            throw new ErrorDeExistencias('Existencias insuficientes o cantidad fuera del límite permitido.', 409);
        }
    }

    private function guardarCambio(string $id, array $variante, string $fecha, int $antes, string $operación, int $margenAdicional = 0): void
    {
        $this->saldo($variante);
        // Las variantes de semillas anteriores no incluían este contador. La versión
        // empieza en 1 y aumenta una vez por operación, así que conserva el límite.
        $variante['operaciones'] ??= $variante['versión_sincronización'];
        // No se borran comprobantes, movimientos ni eventos para eludir los límites locales.
        $terminacionesPendientes = $margenAdicional;
        foreach ($this->reservas as $reserva) {
            if ($reserva['estado'] !== 'ACTIVA') continue;
            foreach ($reserva['líneas'] as $línea) if ($línea['identificador_variante'] === $id) $terminacionesPendientes++;
        }
        if ($variante['operaciones'] + $terminacionesPendientes >= 256) throw new ErrorDeExistencias('La variante alcanzó el límite de 256 operaciones, incluyendo espacio para terminar reservas activas; requiere revisión técnica sin borrar historial.');
        $variante['operaciones']++;
        $variante['versión_sincronización']++;
        $variante['fecha_actualización'] = $fecha;
        $mínimoAnterior = $this->variantes[$id]['mínimo'];
        if ($antes > $mínimoAnterior && $variante['disponible'] <= $variante['mínimo']) {
            $this->eventos[] = ['identificador' => self::uuid(), 'tipo' => 'stock_bajo', 'estado' => 'PENDIENTE',
                'identificador_producto' => $variante['identificador_producto'], 'identificador_variante' => $id,
                'disponible' => $variante['disponible'], 'mínimo' => $variante['mínimo'], 'fecha' => $fecha,
                'identificador_operacion' => $operación];
        }
        $this->variantes[$id] = $variante;
    }

    private function reservar(array $datos, string $operación, string $fecha): array
    {
        $id = self::validarUuid($datos['identificador'] ?? null);
        $pedido = self::texto($datos['identificador_pedido'] ?? null, 'identificador_pedido', 160);
        $líneas = $datos['líneas'] ?? null;
        if (!is_array($líneas) || !array_is_list($líneas) || count($líneas) < 1 || count($líneas) > 50) throw new ErrorDeExistencias('La reserva requiere entre 1 y 50 líneas.');
        $normalizadas = [];
        foreach ($líneas as $línea) {
            if (!is_array($línea) || array_diff(array_keys($línea), ['identificador_variante', 'cantidad'])) throw new ErrorDeExistencias('Línea de reserva inválida.');
            $varianteId = self::validarUuid($línea['identificador_variante'] ?? null);
            if (isset($normalizadas[$varianteId])) throw new ErrorDeExistencias('Una variante no puede repetirse en la reserva.');
            $normalizadas[$varianteId] = ['identificador_variante' => $varianteId, 'cantidad' => self::cantidad($línea['cantidad'] ?? null)];
        }
        ksort($normalizadas);
        $normalizadas = array_values($normalizadas);
        if (isset($this->reservas[$id])) {
            $anterior = $this->reservas[$id];
            if ($anterior['identificador_pedido'] !== $pedido || $anterior['líneas'] !== $normalizadas) throw new ErrorDeExistencias('El UUID de reserva ya pertenece a otra solicitud.', 409);
            if ($anterior['estado'] !== 'ACTIVA') throw new ErrorDeExistencias('Una reserva terminada no puede activarse otra vez.', 409);
            return ['reserva' => $anterior];
        }
        // Se valida todo antes de aplicar; la persistencia confirma el agregado completo por CAS.
        // Sin versión esperada: una compra no debe fallar porque otro cliente movió la misma variante
        // si la disponibilidad alcanza; el CAS del agregado ya impide sobrevender.
        foreach ($normalizadas as $línea) {
            $variante = $this->variante($línea['identificador_variante']);
            if (!$variante['activo'] || $variante['disponible'] < $línea['cantidad']) throw new ErrorDeExistencias('Variante inactiva o disponibilidad insuficiente.', 409);
        }
        foreach ($normalizadas as $línea) {
            $varianteId = $línea['identificador_variante'];
            $variante = $this->variante($varianteId);
            $antes = $variante['disponible'];
            $variante['reservada'] += $línea['cantidad'];
            $this->guardarCambio($varianteId, $variante, $fecha, $antes, $operación, 1);
        }
        $reserva = ['identificador' => $id, 'identificador_pedido' => $pedido, 'líneas' => $normalizadas,
            'estado' => 'ACTIVA', 'fecha_creación' => $fecha, 'fecha_actualización' => $fecha, 'versión_sincronización' => 1];
        $this->reservas[$id] = $reserva;
        return ['reserva' => $reserva];
    }

    private function terminarReserva(string $tipo, array $datos, string $operación, string $fecha): array
    {
        $id = self::validarUuid($datos['identificador_reserva'] ?? null);
        $reserva = $this->reserva($id);
        $destino = $tipo === 'CONSUMIR_RESERVA' ? 'CONSUMIDA' : 'LIBERADA';
        if ($reserva['estado'] === $destino) return ['reserva' => $reserva];
        if ($reserva['estado'] !== 'ACTIVA') throw new ErrorDeExistencias('La reserva está '.$reserva['estado'].'; no permite '.$destino.'.', 409);
        foreach ($reserva['líneas'] as $línea) {
            $varianteId = $línea['identificador_variante'];
            $variante = $this->variante($varianteId);
            $antes = $variante['disponible'];
            $variante['reservada'] -= $línea['cantidad'];
            if ($destino === 'CONSUMIDA') {
                $variante['física'] -= $línea['cantidad'];
                $variante['movimientos'][] = $this->movimiento($varianteId, 'SALIDA', $línea['cantidad'], 'Consumo de reserva '.$id, $operación, $fecha, $variante['versión_sincronización'] + 1, null, $id);
            }
            $this->guardarCambio($varianteId, $variante, $fecha, $antes, $operación, -1);
        }
        $reserva['estado'] = $destino;
        $reserva['versión_sincronización']++;
        $reserva['fecha_actualización'] = $fecha;
        $this->reservas[$id] = $reserva;
        return ['reserva' => $reserva];
    }

    private function movimiento(string $id, string $tipo, int $cantidad, string $motivo, string $operación, string $fecha, int $versión, ?string $sentido = null, ?string $reserva = null): array
    {
        return ['identificador' => self::uuid(), 'identificador_variante' => $id, 'tipo' => $tipo,
            'cantidad' => $cantidad, 'motivo' => $motivo, 'sentido' => $sentido, 'fecha' => $fecha,
            'identificador_operacion' => $operación, 'versión_sincronización' => $versión, 'identificador_reserva' => $reserva];
    }

    public static function validarUuid(mixed $valor): string
    {
        if (!is_string($valor) || !preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i', $valor)) throw new ErrorDeExistencias('Se requiere un UUID v4 válido.');
        return strtolower($valor);
    }

    private static function cantidad(mixed $valor, bool $cero = false): int
    {
        if (!is_int($valor) || $valor < ($cero ? 0 : 1) || $valor > 1_000_000_000) throw new ErrorDeExistencias('La cantidad debe ser un entero '.($cero ? 'no negativo' : 'positivo').' de hasta 1000000000.');
        return $valor;
    }

    private static function texto(mixed $valor, string $campo, int $máximo): string
    {
        if (!is_string($valor) || trim($valor) === '' || mb_strlen(trim($valor)) > $máximo) throw new ErrorDeExistencias('El campo '.$campo.' es obligatorio y admite hasta '.$máximo.' caracteres.');
        return trim($valor);
    }
}
