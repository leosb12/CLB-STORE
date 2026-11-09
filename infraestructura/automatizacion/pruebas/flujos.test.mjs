import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const raiz = fileURLToPath(new URL('../../../', import.meta.url));
const flujos = ['clbStockBajo0001', 'clbComprobante01', 'clbAvisosPedido1'].map(id =>
  JSON.parse(readFileSync(new URL(`../flujos/${id}.json`, import.meta.url), 'utf8')));
const codigo = (flujo, nombre) => flujo.nodes.find(n => n.name === nombre).parameters.jsCode;
const ejecutar = (js, contexto) => vm.runInNewContext(`(function () { ${js}\n})()`, contexto);

test('Git admite los adaptadores y sus pruebas, pero sigue excluyendo secretos y datos de ejecución', () => {
  const codigo = ['aplicaciones/android/lib/datos/sesion_keycloak.dart', 'aplicaciones/android/test/datos/datos_test.dart',
    'microservicios/clientes/fuente/fidelizacion/datos/repositorio-dynamodb.ts', 'microservicios/clientes/fuente/perfiles/datos/repositorio-perfiles.ts'];
  const resultado = spawnSync('git', ['check-ignore', '--no-index', ...codigo], {cwd: raiz, encoding:'utf8'});
  assert.equal(resultado.status, 1, resultado.stdout);
  const privados = spawnSync('git', ['check-ignore', '--no-index', 'infraestructura/bases-de-datos/.env', 'infraestructura/datos/base.db',
    'aplicaciones/android/lib/datos/.env', 'aplicaciones/android/lib/datos/clave.key'], {cwd: raiz, encoding:'utf8'});
  assert.equal(privados.status, 0);
  assert.equal(privados.stdout.trim().split(/\r?\n/).length, 4);
});

test('los JSON importados coinciden exactamente con el generador revisado', () => {
  const salida = execFileSync('python', ['-X', 'utf8', '-c',
    "import runpy,json; m=runpy.run_path('infraestructura/automatizacion/generar-flujos.py'); print(json.dumps([m['flujo_stock_bajo'](),m['flujo_comprobante'](),m['flujo_notificaciones']()]))"], {cwd: raiz});
  assert.deepEqual(flujos, JSON.parse(salida));
});

for (const [i, destino] of ['IA', 'Ventas'].entries()) {
  test(`${destino}: un fallo temporal interrumpe el lote antes de avanzar el cursor`, () => {
    const js = codigo(flujos[i], `Verificar respuesta de ${destino}`);
    for (const statusCode of [401, 403, 408, 425, 429, 500, 503]) {
      assert.throws(() => ejecutar(js, {$input: {all: () => [{json: {statusCode}}]}}), /se reintentará/);
    }
    const respuesta = ejecutar(js, {$input: {all: () => [{json: {statusCode: 201}}, {json: {statusCode: 200}}]}});
    assert.equal(respuesta[0].json.procesados, 2);
    const entrada = Object.entries(flujos[i].connections).find(([nombre]) => nombre === `Verificar respuesta de ${destino}`)[1];
    assert.equal(entrada.main[0][0].node, i === 0 ? 'Avanzar cursor' : 'Un pedido a la vez');
  });
}

test('avisos: el cursor avanza solo tras el registro durable en Clientes; error temporal reintenta el mismo lote', () => {
  const flujo = flujos[2];
  const orden = Object.fromEntries(Object.entries(flujo.connections).map(([o, c]) => [o, c.main[0][0].node]));
  assert.equal(orden['Registrar en Clientes'], 'Verificar registro');
  assert.equal(orden['Verificar registro'], 'Avanzar cursor');
  assert.equal(orden['Avanzar cursor'], 'Enviar avisos pendientes');
  const estatico = {avisosDesde: '2026-11-09T12:00:00Z'};
  const lote = ejecutar(codigo(flujo, 'Lote de avisos'), {$getWorkflowStaticData: () => estatico, $input: {first: () => ({json: {siguiente: 9, eventos: [
    {identificador: 6, tipo: 'pedido_confirmado', fecha: '2026-11-08T10:00:00Z', datos: {identificador: 'antiguo', identificador_cliente: 'c0'}},
    {identificador: 7, tipo: 'pedido_confirmado', fecha: '2026-11-09T12:00:01Z', datos: {identificador: 'p1', identificador_cliente: 'c1', email: 'no-viaja@x.bo', total: '1.00'}},
    {identificador: 8, tipo: 'otro', fecha: '2026-11-09T12:00:02Z', datos: {}}]}})}});
  assert.deepEqual(JSON.parse(JSON.stringify(lote[0].json)), {siguiente: 9, eventos: [{evento: 'ventas:7', tipo: 'pedido_confirmado', cliente: 'c1', pedido: 'p1'}]});
  const verificar = codigo(flujo, 'Verificar registro');
  const contexto = (statusCode, estatico = {}) => ({$input: {first: () => ({json: {statusCode, body: {mensaje: 'x'}}})},
    $getWorkflowStaticData: () => estatico, $: () => ({first: () => ({json: {desde: 3}})})});
  for (const statusCode of [401, 403, 429, 500, 503]) assert.throws(() => ejecutar(verificar, contexto(statusCode)), /se reintentará/);
  assert.equal(ejecutar(verificar, contexto(202))[0].json.estado, 202);
  const rechazos = {};
  ejecutar(verificar, contexto(422, rechazos));
  assert.equal(rechazos.rechazados[0].destino, 'Clientes');
  const primero = {};
  ejecutar(codigo(flujo, 'Lote de avisos'), {$getWorkflowStaticData: () => primero, $input: {first: () => ({json: {siguiente: 1, eventos: []}})}});
  assert.ok(primero.avisosDesde, 'el primer arranque fija desde cuándo se avisa');
  assert.ok(!JSON.stringify(flujo).includes('CLB_FIREBASE') && !JSON.stringify(flujo).includes('CLB_RESEND'), 'los secretos de envío no pasan por n8n');
});

test('el comprobante conserva como datos los nombres con fórmulas y expresiones n8n', () => {
  const nombre = '=HYPERLINK("https://ejemplo.invalid", "abrir")';
  const descripcion = '={{ $env.CLB_N8N_SECRETO }}';
  const pedido = {identificador:'pedido', identificador_cliente:'cliente', 'fecha_creación':'2026-10-22T12:00:00Z', moneda:'BOB', total:'20.00',
    'líneas':[{nombre, identificador_producto:'producto', sku:'CLB-A', talla:'M', color:'Negro', cantidad:2, precio:'10.00', subtotal:'20.00'}]};
  const entradas = {'Un pedido a la vez':{pedido}, 'Puntos del cliente':{saldo:2,movimientos:[],pedido:{'acreditación':{puntos:2}}},
    'Productos de Inventario':{productos:[{identificador:'producto','descripción':descripcion}]}};
  const filas = ejecutar(codigo(flujos[1], 'Filas del comprobante'), {$getWorkflowStaticData: () => ({}), $: nombre => ({first: () => ({json:entradas[nombre]})})});
  assert.equal(filas[4].json.Concepto, nombre);
  assert.ok(filas[4].json.Detalle.includes(descripcion));
  assert.equal(filas[4].json['Subtotal (Bs)'], 20);
});

test('M03: una variante desactivada se registra como rechazada y no detiene el lote; un error temporal sí', () => {
  const js = codigo(flujos[0], 'Armar alerta');
  const estatico = {};
  const evento = (id) => ({json: {identificador: id, identificador_variante: 'v-' + id, disponible: 1, 'mínimo': 3, fecha: 'f', siguiente: 7}});
  const variante = {statusCode: 200, body: {variante: {sku: 'CLB-A-M', talla: 'M', color: 'Negro'}}};
  const contexto = (variantes, productos) => ({
    $getWorkflowStaticData: () => estatico,
    $: (nodo) => ({all: () => nodo === 'Solo stock_bajo' ? variantes.map((_, i) => evento('e' + i)) : variantes.map((json) => ({json}))}),
    $input: {all: () => productos.map((json) => ({json}))},
  });
  const alertas = ejecutar(js, contexto([{statusCode: 404, body: {}}, variante], [{statusCode: 404}, {statusCode: 200, body: {producto: {nombre: 'Polera'}}}]));
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].json.producto, 'Polera');
  assert.equal(JSON.stringify(estatico.rechazados.map((r) => [r.evento, r.estado])), JSON.stringify([['e0', 404]]));
  // Todo el lote rechazado: el cursor avanza aquí porque los nodos siguientes no se ejecutan.
  assert.equal(ejecutar(js, contexto([{statusCode: 404, body: {}}], [{statusCode: 404}])).length, 0);
  assert.equal(estatico.cursorInventario, 7);
  assert.equal(estatico.rechazados.length, 1, 'el mismo evento no se duplica en el registro');
  for (const [v, pr] of [[{statusCode: 503}, {statusCode: 200}], [variante, {statusCode: 500}], [variante, {statusCode: 401}]]) {
    assert.throws(() => ejecutar(js, contexto([v], [pr])), /se reintentará/);
  }
});

test('M05: sin la acreditación del pedido (lectura consistente) el comprobante espera y se reintenta', () => {
  const estatico = {};
  let pedido = {identificador:'pedido', identificador_cliente:'cliente', 'fecha_creación': new Date().toISOString(), moneda:'BOB', total:'20.00', 'líneas':[]};
  const correr = (puntos) => ejecutar(codigo(flujos[1], 'Filas del comprobante'), {$getWorkflowStaticData: () => estatico,
    $: (n) => ({first: () => ({json: {'Un pedido a la vez': {pedido}, 'Puntos del cliente': puntos, 'Productos de Inventario': {productos: []}}[n]})})});
  assert.throws(() => correr({saldo: 0, movimientos: [], pedido: {'acreditación': null, reversa: null}}), /se reintentará/);
  // Más de 10 min sin acreditación: no bloquea la cola; queda en rechazados y el comprobante lo dice.
  pedido = {...pedido, 'fecha_creación': '2026-10-22T12:00:00Z'};
  const filas = correr({saldo: 0, movimientos: [], pedido: {'acreditación': null, reversa: null}});
  assert.equal(filas.find((f) => f.json.Concepto === 'Puntos ganados').json.Detalle, 'No disponible (en revisión)');
  assert.equal(estatico.rechazados[0].evento, 'pedido#pedido');
  assert.equal(correr({saldo: 4, movimientos: [], pedido: {'acreditación': {puntos: 2}}}).find((f) => f.json.Concepto === 'Puntos ganados').json.Detalle, '2');
  const consulta = flujos[1].nodes.find((n) => n.name === 'Puntos del cliente').parameters.queryParameters.parameters;
  assert.deepEqual(consulta.map((q) => q.name), ['pedido']);
});

test('M04: las ejecuciones exitosas no guardan datos (el token de servicio viaja entre nodos)', () => {
  for (const f of flujos) {
    assert.equal(f.settings.saveDataSuccessExecution, 'none');
    assert.equal(f.settings.saveManualExecutions, false);
  }
});

test('xlsx de la imagen n8n instalada escribe fórmulas potenciales como texto literal', {skip: process.env.CLB_PRUEBA_N8N !== '1'}, () => {
  const base = '/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-nodes-base@file++++home+runner+_work+n8n+n8n+packages+nodes-base/node_modules/n8n-nodes-base/dist/utils/binary.js';
  const script = `const assert = require('node:assert/strict');
    const xlsx = require('node:module').createRequire(${JSON.stringify(base)})('@e965/xlsx');
    const valores = ['=1+1','+cmd','-2+3','@SUM(A1)','={{ $env.CLB_N8N_SECRETO }}'];
    const hoja = xlsx.utils.json_to_sheet(valores.map(Concepto=>({Concepto})));
    const libro = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(libro,hoja,'Comprobante');
    const reabierto = xlsx.read(xlsx.write(libro,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets.Comprobante;
    valores.forEach((valor,i)=>{const celda = reabierto['A'+(i+2)]; assert.equal(celda.t,'s'); assert.equal(celda.v,valor); assert.equal(celda.f,undefined);});
    console.log('XLSX: todas las cadenas permanecen texto, ninguna fórmula ejecutable.');`;
  execFileSync('docker', ['exec', 'clb_automatizacion', 'node', '-e', script], {stdio:'pipe'});
});
