<?php

declare(strict_types=1);

namespace Clb\Inventario\Adaptadores\Entrada;

use Clb\Inventario\Aplicacion\DatosRegistroProducto;
use Clb\Inventario\Dominio\SkuDuplicado;
use Clb\Inventario\Puertos\Entrada\PuertoRegistrarProducto;
use Illuminate\Console\Command;

final class CargarCatalogoDemostracion extends Command
{
    protected $signature = 'clb:catalogo-demostracion';

    protected $description = 'Registra prendas de demostración locales sin duplicar SKU ni modificar productos existentes.';

    public function handle(PuertoRegistrarProducto $registrar): int
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->error('Este comando solo se permite en desarrollo local.');
            return self::FAILURE;
        }
        $prendas = [
            ['CLB-DEMO-01', 'Camisa de lino natural', 'Camisa ligera de manga larga, con tejido de lino y corte relajado.', 'Camisas', '189.90'],
            ['CLB-DEMO-02', 'Camiseta esencial', 'Algodón suave, cuello redondo y un diseño para todos los días.', 'Camisetas', '79.00'],
            ['CLB-DEMO-03', 'Pantalón de sarga', 'Pantalón de corte recto y tejido resistente en tono arena.', 'Pantalones', '229.00'],
            ['CLB-DEMO-04', 'Chaqueta urbana', 'Una capa ligera con bolsillos amplios para acompañar tus días.', 'Chaquetas', '349.90'],
            ['CLB-DEMO-05', 'Suéter de punto', 'Textura cálida de punto fino con cuello redondo.', 'Tejidos', '259.50'],
            ['CLB-DEMO-06', 'Vestido de algodón', 'Silueta fluida y tejido transpirable para moverte con libertad.', 'Vestidos', '279.00'],
            ['CLB-DEMO-07', 'Camisa de diseño', 'Camisa de algodón con detalles de confección boliviana.', 'Camisas', '159.90'],
            ['CLB-DEMO-08', 'Pantalón denim recto', 'Denim clásico de corte recto y acabado azul profundo.', 'Pantalones', '249.00'],
        ];
        foreach ($prendas as $prenda) {
            try {
                $producto = $registrar->ejecutar(new DatosRegistroProducto(...$prenda));
                $this->info('Registrado: '.$producto->sku->valor);
            } catch (SkuDuplicado) {
                $this->line('Ya existe: '.$prenda[0]);
            }
        }
        return self::SUCCESS;
    }
}
