<?php

return [
    'local_habilitada' => (bool) env('CLB_ADMINISTRACION_LOCAL_HABILITADA', false),
    // Solo se aceptan pares locales o de las redes de desarrollo de Docker.
    'redes_locales' => explode(',', env('CLB_ADMINISTRACION_REDES_LOCALES', '127.0.0.0/8,::1/128')),
];
