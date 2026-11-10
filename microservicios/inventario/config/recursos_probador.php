<?php

return ['habilitado' => env('CLB_RECURSOS_PROBADOR', false), 'directorio' => env('CLB_RECURSOS_DIRECTORIO', storage_path('app/prendas')),
    'archivos_url' => env('CLB_ARCHIVOS_URL', ''), 'url_token' => env('CLB_ARCHIVOS_URL_TOKEN', ''),
    'secreto' => env('CLB_IDENTIDAD_SECRETO_INVENTARIO', '')];
