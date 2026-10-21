<?php

return [
    'name' => env('APP_NAME', 'CLB Store — Inventario'),
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://127.0.0.1:18080'),
    'timezone' => 'UTC',
    'locale' => 'es',
    'fallback_locale' => 'es',
    'cipher' => 'AES-256-CBC',
    'key' => env('APP_KEY'),
    'maintenance' => ['driver' => 'file'],
];
