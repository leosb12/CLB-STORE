<?php
/** Mantenimiento local explícito; no es un endpoint ni se ejecuta al arrancar. */
declare(strict_types=1);
require 'vendor/autoload.php';
$app = require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$c = Illuminate\Support\Facades\DB::connection('mongodb')->getCollection(config('inventario.colección'));
$opts = ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']];
$modo = $argv[1] ?? 'inspeccionar';
$raiz = config('recursos_probador.directorio');
if ($modo === 'exportar') {
    $productos = []; $archivos = []; $ids = [];
    foreach ($c->find(['identificador' => ['$exists' => true]], $opts) as $p) {
        // Excluir exclusivamente productos identificados como ensayos automáticos.
        if (str_starts_with($p['nombre'], '[DEMO]')) continue;
        $campos = ['identificador','sku','nombre','descripción','categoría','precio_centavos','moneda','activo','recurso_probador'];
        $p = array_intersect_key($p, array_flip($campos));
        $ids[] = $p['identificador'];
        $r = $p['recurso_probador'] ?? null;
        if ($r) {
            foreach (array_unique(array_filter([$r['sha256'], $r['maestro_sha256'] ?? null, $r['espalda']['sha256'] ?? null])) as $hash) {
                if (!preg_match('/^[a-f0-9]{64}$/', $hash)) throw new RuntimeException('Hash inválido');
                $ruta = $raiz.'/publicado/'.$hash;
                if (!is_file($ruta)) $ruta = $raiz.'/maestro/'.$hash;
                if (!is_file($ruta) || hash_file('sha256', $ruta) !== $hash) throw new RuntimeException('Recurso ausente o corrupto');
                $archivos[$hash] = base64_encode(file_get_contents($ruta));
            }
        }
        $productos[] = $p;
    }
    $e = $c->findOne(['_id' => 'clb_existencias'], $opts);
    $variantes = [];
    foreach (($e['variantes'] ?? []) as $v) {
        if (!in_array($v['identificador_producto'], $ids, true)) continue;
        $variantes[] = array_intersect_key($v, array_flip(['identificador','identificador_producto','sku','talla','color','activo','mínimo']));
    }
    echo json_encode(['version'=>1, 'stock_inicial'=>10, 'productos'=>$productos, 'variantes'=>$variantes, 'archivos'=>$archivos], JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    exit;
}
if ($modo !== 'importar' && $modo !== 'reiniciar') throw new RuntimeException('Modo inválido');
$s = json_decode(file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
if (($s['version'] ?? null) !== 1 || !$s['productos'] || !$s['variantes']) throw new RuntimeException('Semilla inválida');
if ($modo === 'importar' && $c->countDocuments() !== 0) throw new RuntimeException('Inventario no vacío; importar no sobrescribe');
$productos = []; $variantes = []; $ids = []; $hashes = [];
$ahora = new MongoDB\BSON\UTCDateTime;
foreach ($s['productos'] as $p) {
    $id = $p['identificador'];
    if (!preg_match('/^[a-f0-9]{32}$/', $id) || isset($ids[$id])) throw new RuntimeException('Identificador inválido/repetido');
    $ids[$id] = true;
    $p['_id'] = $id; $p['fecha_creación'] = $ahora; $p['fecha_actualización'] = $ahora;
    $p['versión_sincronización'] = 1; $p['clb_esquema_variantes'] = 1; $p['clb_sku_producto'] = true;
    $r = $p['recurso_probador'] ?? null;
    $publicados = $r ? array_values(array_unique(array_filter([$r['sha256'], $r['maestro_sha256'] ?? null, $r['espalda']['sha256'] ?? null]))) : [];
    foreach ($publicados as $hash) {
        if (!preg_match('/^[a-f0-9]{64}$/', $hash)) throw new RuntimeException('Hash inválido');
        $ruta = '/tmp/clb-semilla/recursos/'.$hash.'.png';
        if (!is_file($ruta) || hash_file('sha256', $ruta) !== $hash) throw new RuntimeException('Recurso corrupto: '.$hash);
        $hashes[$hash] = $ruta;
    }
    if ($r) $p['clb_recursos'] = ['revision'=>0,'trabajos'=>(object)[],'comprobantes'=>(object)[],'publicados'=>$publicados,'pendiente'=>false,'hasta'=>0];
    $productos[] = $p;
}
foreach ($s['variantes'] as $v) {
    if (!isset($ids[$v['identificador_producto']]) || isset($variantes[$v['identificador']])) throw new RuntimeException('Variante inválida');
    $v['física'] = $s['stock_inicial']; $v['reservada'] = 0; $v['disponible'] = $s['stock_inicial'];
    $v['fecha_creación'] = $ahora->toDateTime()->format('Y-m-d\TH:i:s.v\Z'); $v['fecha_actualización'] = $v['fecha_creación'];
    $v['versión_sincronización'] = 1; $v['movimientos'] = [];
    $variantes[$v['identificador']] = $v;
}
// Validar todos los archivos y documentos antes de la primera mutación.
foreach ($hashes as $hash=>$origen) foreach (['publicado','textura','maestro'] as $tipo) {
    $dir = $raiz.'/'.$tipo;
    if (!is_dir($dir) && !mkdir($dir,0770,true)) throw new RuntimeException('No se pudo crear directorio');
    if (!copy($origen,$dir.'/'.$hash)) throw new RuntimeException('No se pudo copiar recurso');
}
$wc = ['writeConcern'=>new MongoDB\Driver\WriteConcern(1,10000,true)];
// Solo se permite reiniciar con servicios escritores detenidos por preparar.py.
if ($modo === 'reiniciar') $c->deleteMany([], $wc);
$c->insertMany($productos, $wc);
$c->insertOne(['_id'=>'clb_existencias','revisión'=>1,'variantes'=>(object)$variantes,'reservas'=>(object)[], 'eventos'=>[],
    'clb_skus_variantes'=>array_column($variantes,'sku'),'clb_claves_operacion'=>[],'clb_resultados_operacion'=>(object)[]],$wc);
echo json_encode(['productos'=>count($productos),'variantes'=>count($variantes),'recursos'=>count($hashes)])."\n";
