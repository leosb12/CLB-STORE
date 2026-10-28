<?php

declare(strict_types=1);

namespace Pruebas\Http;

use Pruebas\Soporte\PruebaConMongoDB;
use Clb\Inventario\Dominio\Existencias;

final class ExistenciasHttpTest extends PruebaConMongoDB
{
    private function producto(): string { return $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true])->assertCreated()->json('producto.identificador'); }
    private function variante(string $producto, string $sku = 'CLB-NEGRO-M'): string
    {
        $id = Existencias::uuid();
        $this->postJson('/api/v1/productos/'.$producto.'/variantes', ['identificador' => $id, 'sku' => $sku, 'talla' => 'M', 'color' => 'Negro', 'activo' => true])->assertCreated()->assertJsonPath('variante.disponible', 0);
        return $id;
    }
    private function entrada(string $variante, int $cantidad = 10): void
    {
        $this->postJson('/api/v1/variantes/'.$variante.'/movimientos', ['tipo' => 'ENTRADA', 'cantidad' => $cantidad, 'motivo' => 'Recepción física', 'versión_esperada' => 1])->assertCreated();
    }
    public function test_recorrido_real_con_repeticion_y_conflictos(): void
    {
        $producto = $this->producto(); $id = $this->variante($producto); $this->entrada($id);
        $this->getJson('/api/v1/productos/'.$producto.'/variantes')->assertOk()->assertJsonCount(1, 'variantes');
        $this->getJson('/api/v1/productos/administracion')->assertOk()->assertJsonCount(1, 'productos');
        $clave = Existencias::uuid();
        $datos = ['tipo' => 'SALIDA', 'cantidad' => 3, 'motivo' => 'Salida auditada', 'versión_esperada' => 2];
        $primera = $this->postJson('/api/v1/variantes/'.$id.'/movimientos', $datos, ['Idempotency-Key' => $clave])->assertCreated()->json();
        self::assertSame($primera, $this->postJson('/api/v1/variantes/'.$id.'/movimientos', $datos, ['Idempotency-Key' => $clave])->assertCreated()->json());
        $this->postJson('/api/v1/variantes/'.$id.'/movimientos', [...$datos, 'cantidad' => 4], ['Idempotency-Key' => $clave])->assertConflict();
        $this->postJson('/api/v1/variantes/'.$id.'/movimientos', $datos)->assertConflict()->assertJsonPath('variante_actual.disponible', 7);
        $this->getJson('/api/v1/variantes/'.$id.'/movimientos')->assertOk()->assertJsonCount(2, 'movimientos');
        $this->getJson('/api/v1/variantes/'.$id.'/existencias')->assertOk()->assertJsonPath('variante.física', 7);
    }
    public function test_reserva_multiple_compensacion_y_consumo_durable(): void
    {
        $producto = $this->producto(); $a = $this->variante($producto); $b = $this->variante($producto, 'CLB-BLANCO-M');
        $this->entrada($a); $this->entrada($b);
        $id = Existencias::uuid(); $clave = Existencias::uuid();
        $datos = ['identificador' => $id, 'identificador_pedido' => 'pedido-externo', 'líneas' => [['identificador_variante' => $a, 'cantidad' => 4], ['identificador_variante' => $b, 'cantidad' => 3]]];
        $reserva = $this->postJson('/api/v1/interno/reservas', $datos, ['Idempotency-Key' => $clave])->assertCreated()->json();
        self::assertSame($reserva, $this->postJson('/api/v1/interno/reservas', $datos, ['Idempotency-Key' => $clave])->assertCreated()->json());
        $reordenados = $datos;
        $reordenados['líneas'] = array_reverse(array_map(fn ($línea) => array_reverse($línea, true), $datos['líneas']));
        self::assertSame($reserva, $this->postJson('/api/v1/interno/reservas', $reordenados, ['Idempotency-Key' => $clave])->assertCreated()->json());
        $this->postJson('/api/v1/interno/reservas/'.$id.'/liberar')->assertOk()->assertJsonPath('reserva.estado', 'LIBERADA');
        $this->postJson('/api/v1/interno/reservas/'.$id.'/liberar')->assertOk();
        $this->getJson('/api/v1/variantes/'.$a)->assertJsonPath('variante.disponible', 10)->assertJsonPath('variante.reservada', 0);
        $this->postJson('/api/v1/interno/reservas/'.$id.'/consumir')->assertConflict();
        $id = Existencias::uuid(); $datos['identificador'] = $id;
        $this->postJson('/api/v1/interno/reservas', $datos)->assertCreated();
        $clave = Existencias::uuid();
        $consumo = $this->postJson('/api/v1/interno/reservas/'.$id.'/consumir', [], ['Idempotency-Key' => $clave])->assertOk()->json();
        self::assertSame($consumo, $this->postJson('/api/v1/interno/reservas/'.$id.'/consumir', [], ['Idempotency-Key' => $clave])->assertOk()->json());
        $this->postJson('/api/v1/interno/reservas/'.$id.'/consumir')->assertOk();
        $this->getJson('/api/v1/variantes/'.$a)->assertJsonPath('variante.física', 6)->assertJsonPath('variante.reservada', 0);
        $this->getJson('/api/v1/variantes/'.$a.'/movimientos')->assertJsonCount(2, 'movimientos');
    }
    public function test_migracion_repetible_y_deduplicacion_compartida(): void
    {
        $clave = Existencias::uuid();
        $producto = $this->postJson('/api/v1/productos', [...$this->datos(), 'activo' => true], ['Idempotency-Key' => $clave])->assertCreated()->json('producto.identificador');
        $repositorio = app(\Clb\Inventario\Puertos\Salida\RepositorioExistencias::class);
        self::assertSame(1, $repositorio->migrar());
        self::assertSame(0, $repositorio->migrar());
        $this->getJson('/api/v1/productos')->assertJsonCount(1, 'productos');
        $this->getJson('/api/v1/productos/'.$producto.'/variantes')->assertJsonCount(0, 'variantes');
        $this->postJson('/api/v1/productos/'.$producto.'/variantes', ['identificador' => Existencias::uuid(), 'sku' => 'X', 'talla' => 'M', 'color' => 'Negro', 'activo' => true], ['Idempotency-Key' => $clave])->assertConflict();
    }
    public function test_eventos_solo_en_cruces_y_persistentes(): void
    {
        $producto = $this->producto(); $id = $this->variante($producto); $this->entrada($id);
        $this->putJson('/api/v1/variantes/'.$id.'/minimo', ['mínimo' => 5, 'versión_esperada' => 2], ['Idempotency-Key' => Existencias::uuid()])->assertOk();
        $datos = ['tipo' => 'SALIDA', 'cantidad' => 5, 'motivo' => 'Salida', 'versión_esperada' => 3];
        $clave = Existencias::uuid();
        $this->postJson('/api/v1/variantes/'.$id.'/movimientos', $datos, ['Idempotency-Key' => $clave])->assertCreated();
        $this->postJson('/api/v1/variantes/'.$id.'/movimientos', $datos, ['Idempotency-Key' => $clave])->assertCreated();
        $this->getJson('/api/v1/interno/eventos')->assertOk()->assertJsonCount(1, 'eventos')->assertJsonPath('eventos.0.estado', 'PENDIENTE');
        self::assertCount(1, $this->colección->findOne(['_id' => 'clb_existencias'])['eventos']);
    }
    public function test_cursor_de_eventos_por_consumidor(): void
    {
        $producto = $this->producto(); $a = $this->variante($producto); $b = $this->variante($producto, 'CLB-BLANCO-M');
        foreach ([$a, $b] as $id) {
            $this->entrada($id);
            $this->putJson('/api/v1/variantes/'.$id.'/minimo', ['mínimo' => 10, 'versión_esperada' => 2], ['Idempotency-Key' => Existencias::uuid()])->assertOk();
        }
        $this->getJson('/api/v1/interno/eventos?desde=0&l%C3%ADmite=1')->assertOk()->assertJsonCount(1, 'eventos')->assertJsonPath('siguiente', 1)->assertJsonPath('eventos.0.identificador_variante', $a);
        $this->getJson('/api/v1/interno/eventos?desde=1')->assertOk()->assertJsonCount(1, 'eventos')->assertJsonPath('siguiente', 2)->assertJsonPath('eventos.0.identificador_variante', $b);
        // Otro consumidor lee desde el inicio sin afectar al primero.
        $this->getJson('/api/v1/interno/eventos?desde=0')->assertOk()->assertJsonCount(2, 'eventos');
        $this->getJson('/api/v1/interno/eventos?desde=2')->assertOk()->assertJsonCount(0, 'eventos')->assertJsonPath('siguiente', 2);
        // Un cursor de un registro recreado (mayor que el total) no se ignora en silencio.
        $this->getJson('/api/v1/interno/eventos?desde=3')->assertConflict();
        foreach (['desde=-1', 'desde=x', 'l%C3%ADmite=0', 'l%C3%ADmite=101'] as $consulta) {
            $this->getJson('/api/v1/interno/eventos?'.$consulta)->assertStatus(422)->assertJsonPath('código', 'EXISTENCIAS_INVALIDAS');
        }
    }
    public function test_salud_informa_dependencia(): void
    {
        $this->getJson('/salud')->assertOk()->assertExactJson(['estado' => 'ACTIVO', 'servicio' => 'inventario', 'dependencias' => ['mongodb' => 'ACTIVO']]);
    }
    public function test_comandos_y_reservas_prohibidos_sin_habilitacion(): void
    {
        config(['administracion.local_habilitada' => false]);
        $this->postJson('/api/v1/productos/x/variantes')->assertForbidden();
        $this->postJson('/api/v1/interno/reservas')->assertForbidden();
        $this->getJson('/api/v1/interno/eventos')->assertForbidden();
    }
}
