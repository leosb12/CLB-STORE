<?php

return [
    'default' => 'mongodb',
    'connections' => [
        'mongodb' => [
            'driver' => 'mongodb',
            'host' => env('CLB_MONGO_SERVIDOR', '127.0.0.1').':'.env('CLB_MONGO_PUERTO', '27017'),
            'database' => env('CLB_MONGO_BASE', 'clb_inventario'),
            'username' => env('CLB_MONGO_USUARIO'),
            'password' => env('CLB_MONGO_CLAVE'),
            'options' => [
                'authSource' => env('CLB_MONGO_AUTENTICACION', 'clb_inventario'),
                'serverSelectionTimeoutMS' => 5000,
            ],
        ],
    ],
];
