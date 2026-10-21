<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

if (file_exists($mantenimiento = __DIR__.'/../storage/framework/maintenance.php')) {
    require $mantenimiento;
}

require __DIR__.'/../vendor/autoload.php';

/** @var Application $aplicación */
$aplicación = require_once __DIR__.'/../bootstrap/app.php';

$aplicación->handleRequest(Request::capture());
