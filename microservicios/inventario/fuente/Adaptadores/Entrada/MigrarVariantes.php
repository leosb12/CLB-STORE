<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

final class MigrarVariantes extends \Illuminate\Console\Command
{
    protected $signature = 'clb:migrar-variantes';
    protected $description = 'Marca el esquema de variantes sin inventar tallas, colores ni existencias.';

    public function handle(\Clb\Inventario\Puertos\Salida\RepositorioExistencias $repositorio): int
    {
        $this->info('Productos actualizados sin alterar sus datos: '.$repositorio->migrar());
        return self::SUCCESS;
    }
}
