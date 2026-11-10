<?php

$uri = env('CLB_MONGO_URI');

return [
    'default' => 'mongodb',
    'connections' => [
        'mongodb' => [
            'driver' => 'mongodb',
            'database' => env('CLB_MONGO_BASE', 'clb_inventario'),
        ] + ($uri ? [
            'dsn' => $uri,
            'options' => ['serverSelectionTimeoutMS' => 5000],
        ] : [
            'host' => env('CLB_MONGO_SERVIDOR', '127.0.0.1').':'.env('CLB_MONGO_PUERTO', '27017'),
            'username' => env('CLB_MONGO_USUARIO'),
            'password' => env('CLB_MONGO_CLAVE'),
            'options' => [
                'authSource' => env('CLB_MONGO_AUTENTICACION', 'clb_inventario'),
                'serverSelectionTimeoutMS' => 5000,
            ],
        ]),
    ],
];
