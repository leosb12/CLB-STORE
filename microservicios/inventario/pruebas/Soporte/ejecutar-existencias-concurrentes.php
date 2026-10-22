<?php

declare(strict_types=1);

require dirname(__DIR__, 2).'/vendor/autoload.php';
$entrada = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
if (!preg_match('/^clb_prueba_[a-f0-9]+$/', $entrada['colección'])) exit(2);
$aplicación = require dirname(__DIR__, 2).'/bootstrap/app.php';
$aplicación->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
config(['inventario.colección' => $entrada['colección']]);
while (microtime(true) < $entrada['esperar_hasta']) usleep(1000);
try {
    $resultado = $aplicación->make(\Clb\Inventario\Puertos\Entrada\PuertoGestionarExistencias::class)->ejecutar($entrada['tipo'], $entrada['datos'], $entrada['clave']);
    echo json_encode(['estado' => 200, 'resultado' => $resultado], JSON_UNESCAPED_UNICODE);
} catch (\Clb\Inventario\Dominio\ErrorDeExistencias $error) { echo json_encode(['estado' => $error->estado]); }
catch (\Clb\Inventario\Dominio\SkuDuplicado) { echo json_encode(['estado' => 409]); }
