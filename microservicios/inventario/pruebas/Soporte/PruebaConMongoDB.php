<?php

declare(strict_types=1);

namespace Pruebas\Soporte;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\DB;
use MongoDB\Collection;

abstract class PruebaConMongoDB extends TestCase
{
    protected Collection $colección;

    private string $nombreColección;

    public function createApplication(): Application
    {
        $aplicación = require dirname(__DIR__, 2).'/bootstrap/app.php';
        $aplicación->make(Kernel::class)->bootstrap();

        return $aplicación;
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['administracion.local_habilitada' => true]);
        $this->nombreColección = 'clb_prueba_'.bin2hex(random_bytes(8));
        config(['inventario.colección' => $this->nombreColección]);
        $this->colección = DB::connection('mongodb')->getCollection($this->nombreColección);
    }

    protected function tearDown(): void
    {
        try {
            if (isset($this->colección) && str_starts_with($this->nombreColección, 'clb_prueba_')) {
                $this->colección->drop();
            }
        } finally {
            parent::tearDown();
        }
    }

    protected function datos(): array
    {
        return ['sku' => 'CLB-CAMISA-1', 'nombre' => 'Camisa de diseño',
            'descripción' => 'Confección boliviana para año nuevo', 'categoría' => 'Camisas',
            'precio' => '129.90', 'activo' => false];
    }

    // Las pruebas previas de registro conservan sus aserciones y usan el nuevo contrato HTTP.
    public function postJson($uri, array $datos = [], array $cabeceras = [], $opciones = 0)
    {
        return parent::postJson($uri, $datos, $cabeceras + ['Idempotency-Key' => \Illuminate\Support\Str::uuid()->toString()], $opciones);
    }
}
