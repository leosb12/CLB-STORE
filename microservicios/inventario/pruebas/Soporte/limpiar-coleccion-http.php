<?php

declare(strict_types=1);

$nombre = $argv[1] ?? '';
if (! preg_match('/\Aclb_prueba_web_[0-9a-f]{32}\z/', $nombre)) {
    fwrite(STDERR, "Solo se permite limpiar la colección temporal de esta prueba.\n");
    exit(2);
}
require dirname(__DIR__, 2).'/vendor/autoload.php';
$aplicación = require dirname(__DIR__, 2).'/bootstrap/app.php';
$aplicación->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
\Illuminate\Support\Facades\DB::connection('mongodb')->getCollection($nombre)->drop();
echo 'Colección temporal eliminada: '.$nombre.PHP_EOL;
