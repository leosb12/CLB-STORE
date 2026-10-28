<?php

declare(strict_types=1);

// Comprueba HTTP y la conexión real a MongoDB mediante /salud, sin crear ni modificar productos.
// El tiempo supera serverSelectionTimeoutMS (5 s) para leer el 503 DEGRADADO en vez de cortar antes.
$contexto = stream_context_create(['http' => ['timeout' => 8, 'header' => "Accept: application/json\r\n"]]);
$respuesta = @file_get_contents('http://127.0.0.1:8000/salud', false, $contexto);
$datos = $respuesta === false ? null : json_decode($respuesta, true);
exit(is_array($datos) && ($datos['estado'] ?? null) === 'ACTIVO' ? 0 : 1);
