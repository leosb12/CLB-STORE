<?php

return [
    // oidc (predeterminado): tokens de Keycloak con rol admin/servicio. local: restricción de desarrollo solo para pruebas.
    'acceso' => env('CLB_INVENTARIO_ACCESO', 'oidc'),
    'identidad_emisor' => env('CLB_IDENTIDAD_EMISOR', 'http://127.0.0.1:18000/identidad/realms/clb'),
    'identidad_jwks' => env('CLB_IDENTIDAD_JWKS', 'http://127.0.0.1:18000/identidad/realms/clb/protocol/openid-connect/certs'),
    'local_habilitada' => (bool) env('CLB_ADMINISTRACION_LOCAL_HABILITADA', false),
    // Solo se aceptan pares locales o de las redes de desarrollo de Docker.
    'redes_locales' => explode(',', env('CLB_ADMINISTRACION_REDES_LOCALES', '127.0.0.0/8,::1/128')),
];
