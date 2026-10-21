<?php

return [
    'default' => 'single',
    'channels' => [
        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/inventario.log'),
            'level' => env('LOG_LEVEL', 'warning'),
        ],
    ],
];
