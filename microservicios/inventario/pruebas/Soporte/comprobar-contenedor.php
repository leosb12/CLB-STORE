<?php

declare(strict_types=1);

// Ejecutar por stdin en la imagen real. No se instala PHPUnit en el contenedor de aplicación.
require getcwd().'/vendor/autoload.php';
$aplicación = require getcwd().'/bootstrap/app.php';
$aplicación->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$base = \Illuminate\Support\Facades\DB::connection('mongodb');
$originales = $base->getCollection(config('inventario.colección'));
$antes = $originales->countDocuments(['identificador' => ['$exists' => true]]);
$nombre = 'clb_prueba_contenedor_'.bin2hex(random_bytes(16));
config(['inventario.colección' => $nombre]);
$colección = $base->getCollection($nombre);
$uuid = fn () => \Clb\Inventario\Dominio\Existencias::uuid();
$verificar = function (bool $condición, string $mensaje): void { if (!$condición) throw new \RuntimeException($mensaje); };
try {
    $producto = $aplicación->make(\Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto::class)->ejecutar(
        new \Clb\Inventario\Aplicacion\DatosRegistroProducto('CLB-PRUEBA-CONTENEDOR', 'Camiseta de prueba temporal', '', 'Camisetas', '0.29', true, $uuid()));
    $casos = $aplicación->make(\Clb\Inventario\Puertos\Entrada\PuertoGestionarExistencias::class);
    $ids = [];
    foreach (['M', 'L'] as $talla) {
        $id = $uuid(); $ids[] = $id;
        $casos->ejecutar('CREAR_VARIANTE', ['identificador_producto' => $producto->identificador, 'identificador' => $id, 'sku' => 'CLB-CONTENEDOR-'.$talla, 'talla' => $talla, 'color' => 'Negro', 'activo' => true], $uuid());
        $casos->ejecutar('REGISTRAR_MOVIMIENTO', ['identificador_variante' => $id, 'tipo' => 'ENTRADA', 'cantidad' => 8, 'motivo' => 'Recepción temporal comprobada', 'versión_esperada' => 1], $uuid());
        $casos->ejecutar('CONFIGURAR_MINIMO', ['identificador_variante' => $id, 'mínimo' => 2, 'versión_esperada' => 2], $uuid());
    }
    $reserva = $uuid(); $clave = $uuid();
    $datos = ['identificador' => $reserva, 'identificador_pedido' => 'referencia-externa-de-prueba',
        'líneas' => array_map(fn ($id) => ['identificador_variante' => $id, 'cantidad' => 7, 'versión_esperada' => 3], $ids)];
    $uno = $casos->ejecutar('RESERVAR', $datos, $clave);
    $verificar($uno === $casos->ejecutar('RESERVAR', $datos, $clave), 'La reserva debe ser idempotente.');
    foreach ($ids as $id) $verificar($casos->consultar('VARIANTE', $id)['variante']['disponible'] === 1, 'Saldo reservado incorrecto.');
    $clave = $uuid(); $liberada = $casos->ejecutar('LIBERAR_RESERVA', ['identificador_reserva' => $reserva], $clave);
    $verificar($liberada === $casos->ejecutar('LIBERAR_RESERVA', ['identificador_reserva' => $reserva], $clave), 'La compensación debe ser idempotente.');
    $datos['identificador'] = $uuid();
    foreach ($datos['líneas'] as &$línea) { $línea['cantidad'] = 5; $línea['versión_esperada'] = 5; }
    unset($línea);
    $casos->ejecutar('RESERVAR', $datos, $uuid());
    $clave = $uuid(); $consumo = $casos->ejecutar('CONSUMIR_RESERVA', ['identificador_reserva' => $datos['identificador']], $clave);
    $verificar($consumo === $casos->ejecutar('CONSUMIR_RESERVA', ['identificador_reserva' => $datos['identificador']], $clave), 'El consumo debe ser idempotente.');
    foreach ($ids as $id) {
        $variante = $casos->consultar('VARIANTE', $id)['variante'];
        $verificar($variante['física'] === 3 && $variante['reservada'] === 0 && $variante['disponible'] === 3, 'Saldo consumido incorrecto.');
        $verificar(count($casos->consultar('MOVIMIENTOS', $id, true)['movimientos']) === 2, 'Historial duplicado o incompleto.');
    }
    $verificar(count($casos->consultar('EVENTOS')['eventos']) === 2, 'Cruces de stock bajo incorrectos.');
    $verificar($originales->countDocuments(['identificador' => ['$exists' => true]]) === $antes, 'No deben alterarse productos originales.');
    if (!preg_match('/^clb_prueba_contenedor_[a-f0-9]{32}$/', $nombre)) throw new \RuntimeException('Colección fuera del ámbito de prueba.');
    $colección->drop();
    echo json_encode(['comprobación' => 'CONTENEDOR_APROBADO', 'variantes' => 2, 'stock_final_por_variante' => 3,
        'eventos_pendientes' => 2, 'productos_originales' => $antes, 'colección_temporal_eliminada' => $nombre], JSON_UNESCAPED_UNICODE).PHP_EOL;
} catch (\Throwable $error) {
    fwrite(STDERR, 'Falló la comprobación. Se conserva '.$nombre.' para diagnóstico: '.$error->getMessage().PHP_EOL);
    exit(1);
}
