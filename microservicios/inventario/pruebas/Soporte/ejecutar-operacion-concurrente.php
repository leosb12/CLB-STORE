<?php

declare(strict_types=1);

require dirname(__DIR__, 2).'/vendor/autoload.php';
$entrada = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
if (! str_starts_with($entrada['colección'], 'clb_prueba_')) exit(2);
$aplicación = require dirname(__DIR__, 2).'/bootstrap/app.php';
$aplicación->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
config(['inventario.colección' => $entrada['colección']]);
while (microtime(true) < $entrada['esperar_hasta']) usleep(1000);
try {
    $producto = $entrada['tipo'] === 'registrar'
        ? $aplicación->make(\Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto::class)->ejecutar(new \Clb\Inventario\Aplicacion\DatosRegistroProducto(...$entrada['datos']))
        : $aplicación->make(\Clb\Inventario\Puertos\Entrada\PuertoModificarProducto::class)->ejecutar(new \Clb\Inventario\Aplicacion\DatosModificacionProducto(...$entrada['datos']));
    echo json_encode(['estado' => 200, 'producto' => \Clb\Inventario\Adaptadores\Entrada\RepresentacionProducto::de($producto)], JSON_UNESCAPED_UNICODE);
} catch (\Clb\Inventario\Dominio\ConflictoDeVersion) {
    echo json_encode(['estado' => 409]);
}
