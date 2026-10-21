<?php

declare(strict_types=1);

// Comprueba HTTP y la conexión real a MongoDB sin crear ni modificar productos.
$contexto = stream_context_create(['http' => ['timeout' => 5, 'header' => "Accept: application/json\r\n"]]);
$respuesta = @file_get_contents('http://127.0.0.1:8000/api/v1/productos?l%C3%ADmite=1', false, $contexto);
$datos = $respuesta === false ? null : json_decode($respuesta, true);
exit(is_array($datos) && isset($datos['productos'], $datos['paginación']) ? 0 : 1);
