// Ejecutar únicamente por SSM en EC2. Usa el rol de la instancia y la implementación desplegada.
// El emisor efímero vive solo en esta aplicación de ensayo sobre loopback. No cambia el SSO de producción.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { crearAplicacion } from './dist/fuente/aplicacion.js';
import { VerificadorTokens } from './dist/fuente/comun/autenticacion.js';
import { RepositorioDynamoDB } from './dist/fuente/fidelizacion/datos/repositorio-dynamodb.js';
import { RepositorioPerfilesDynamoDB } from './dist/fuente/perfiles/datos/repositorio-perfiles.js';
import { RegistroDynamoArchivos, AlmacenS3 } from './dist/fuente/archivos/datos.js';
import { ServicioArchivos } from './dist/fuente/archivos/negocio.js';

const region = process.env.CLB_DYNAMODB_REGION ?? 'us-east-2';
const bucket = process.env.CLB_S3_BUCKET ?? 'clb-store-archivos-leonardoserrate';
const dynamo = new DynamoDBClient({ region });
const documentos = DynamoDBDocumentClient.from(dynamo);
const s3 = new S3Client({ region });
const registro = new RegistroDynamoArchivos(dynamo, 'clb_archivos');
const archivos = new ServicioArchivos(registro, new AlmacenS3(s3, bucket), bucket);
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'ensayo-efimero', alg: 'RS256' };
const emisor = 'http://127.0.0.1/ensayo-aws';
const titular = randomUUID();
const firmar = (roles, sub = titular) => new SignJWT({ realm_access: { roles } }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setSubject(sub).setIssuer(emisor).setAudience('clb-api').setIssuedAt().setExpirationTime('5m').sign(privateKey);
const app = await crearAplicacion(new RepositorioDynamoDB(dynamo, 'clb_fidelizacion'), new RepositorioPerfilesDynamoDB(dynamo, 'clb_fidelizacion'),
  new VerificadorTokens(createLocalJWKSet({ keys: [jwk] }), emisor), undefined, archivos);
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();
const token = await firmar(['admin', 'cliente']);
const cliente = await firmar(['cliente'], randomUUID());
const resultados = [];
const prueba = async (nombre, accion) => { await accion(); resultados.push(nombre); console.log('OK: ' + nombre); };
const enviar = (ruta, metodo = 'GET', cuerpo, clave, sesion = token) => fetch(base + ruta, { method: metodo,
  headers: { authorization: `Bearer ${sesion}`, 'content-type': 'application/json', ...(clave ? { 'idempotency-key': clave } : {}) },
  ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }) });
let ejemplo;
try {
  await prueba('CRUD real DynamoDB con rol EC2 y fila aislada', async () => {
    const Key = { pk: 'PRUEBA#' + titular, sk: 'CRUD' };
    try {
      await documentos.send(new PutCommand({ TableName: 'clb_fidelizacion', Item: { ...Key, valor: 'creado' }, ConditionExpression: 'attribute_not_exists(pk)' }));
      assert.equal((await documentos.send(new GetCommand({ TableName: 'clb_fidelizacion', Key, ConsistentRead: true }))).Item.valor, 'creado');
      await documentos.send(new UpdateCommand({ TableName: 'clb_fidelizacion', Key, UpdateExpression: 'SET valor = :v', ExpressionAttributeValues: { ':v': 'actualizado' } }));
      assert.equal((await documentos.send(new GetCommand({ TableName: 'clb_fidelizacion', Key, ConsistentRead: true }))).Item.valor, 'actualizado');
    } finally { await documentos.send(new DeleteCommand({ TableName: 'clb_fidelizacion', Key })); }
    assert.equal((await documentos.send(new GetCommand({ TableName: 'clb_fidelizacion', Key, ConsistentRead: true }))).Item, undefined);
  });
  await prueba('Perfil HTTP autenticado persiste y rechaza versión obsoleta', async () => {
    const perfil = { nombre: 'Prueba AWS de persistencia', medidas: { altura_cm: 170 }, 'versión_esperada': 0 };
    assert.equal((await enviar('/api/v1/perfiles/yo', 'PUT', perfil)).status, 200);
    assert.equal((await (await enviar('/api/v1/perfiles/yo')).json()).perfil.nombre, perfil.nombre);
    assert.equal((await enviar('/api/v1/perfiles/yo', 'PUT', perfil)).status, 409);
  });
  await prueba('Fidelización por HTTP y rol EC2: transacción, reintento idempotente y compensación con saldo cero', async () => {
    const sesion = await firmar(['servicio']);
    const pedido = randomUUID(), clave = randomUUID(), reversa = randomUUID();
    const cuerpo = { identificador_pedido: pedido, identificador_cliente: titular, total_centavos: 10000 };
    const ruta = '/api/v1/interno/fidelizacion/acreditaciones';
    const primera = await enviar(ruta, 'POST', cuerpo, clave, sesion);
    assert.equal(primera.status, 201, await primera.clone().text());
    try {
      const original = await primera.json();
      const repetida = await enviar(ruta, 'POST', cuerpo, clave, sesion);
      assert.equal(repetida.status, 201);
      assert.deepEqual(await repetida.json(), original);
      assert.equal((await (await enviar(`/api/v1/fidelizacion/clientes/${titular}`)).json()).saldo, 10);
    } finally {
      const compensada = await enviar('/api/v1/interno/fidelizacion/reversas', 'POST', {
        identificador_pedido: pedido, identificador_cliente: titular }, reversa, sesion);
      assert.equal(compensada.status, 201, await compensada.clone().text());
    }
    assert.equal((await (await enviar(`/api/v1/fidelizacion/clientes/${titular}`)).json()).saldo, 0);
  });
  const binario = await readFile(process.argv[2]);
  const sha256 = createHash('sha256').update(binario).digest('hex');
  const clave = randomUUID();
  const datos = { tipo: 'producto', descripcion: 'Polera gris jaspeada frontal de demostracion', mime: 'image/png', bytes: binario.length, sha256, origen: 'microservicio',
    referencias: { procedencia: 'PNGimg.com/image/5448', licencia: 'CC BY-NC 4.0', prueba: 'ensayo-aws' } };
  await prueba('S3 subida firmada, integridad, ruta estable e imposibilidad de sobrescribir', async () => {
    const respuesta = await enviar('/api/v1/archivos/subidas', 'POST', datos, clave);
    assert.equal(respuesta.status, 201, await respuesta.clone().text());
    const preparada = await respuesta.json();
    ejemplo = preparada.archivo;
    assert.equal((await (await enviar('/api/v1/archivos/subidas', 'POST', datos, clave)).json()).archivo.ruta_s3, ejemplo.ruta_s3);
    let subida = await fetch(preparada.subida.url, { method: 'PUT', headers: preparada.subida.cabeceras, body: binario });
    assert.ok(subida.ok, await subida.text());
    subida = await fetch(preparada.subida.url, { method: 'PUT', headers: preparada.subida.cabeceras, body: binario });
    assert.equal(subida.status, 412, await subida.text());
    const confirmacion = await enviar(`/api/v1/archivos/${clave}/confirmar`, 'POST');
    assert.equal(confirmacion.status, 201, await confirmacion.clone().text());
    ejemplo = (await confirmacion.json()).archivo;
    assert.equal(ejemplo.estado, 'DISPONIBLE');
  });
  await prueba('S3 descarga firmada idéntica; acceso anónimo denegado y aislamiento entre titulares', async () => {
    const descarga = await (await enviar(`/api/v1/archivos/${clave}/descarga`)).json();
    const r = await fetch(descarga.url); assert.ok(r.ok);
    assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'), sha256);
    assert.equal((await fetch(`https://${bucket}.s3.${region}.amazonaws.com/${ejemplo.objeto}`)).status, 403);
    assert.equal((await enviar(`/api/v1/archivos/${clave}/descarga`, 'GET', undefined, undefined, cliente)).status, 404);
    assert.equal((await enviar('/api/v1/archivos/subidas', 'POST', datos, randomUUID(), cliente)).status, 403);
    assert.equal((await enviar('/api/v1/archivos/subidas', 'POST', { ...datos, descripcion: 'otro archivo' }, clave)).status, 409);
  });
  await prueba('Registro durable de ubicación consultable por titular', async () => {
    for (let intento = 0; intento < 20; intento++) {
      const listado = await (await enviar('/api/v1/archivos')).json();
      if (listado.archivos.some(a => a.ruta_s3 === ejemplo.ruta_s3)) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('El índice de archivos no convergió.');
  });
  const borrar = randomUUID();
  await prueba('Eliminación S3 repetible conserva comprobante de la ruta', async () => {
    const p = await (await enviar('/api/v1/archivos/subidas', 'POST', { ...datos, descripcion: 'Polera gris ensayo de borrado' }, borrar)).json();
    assert.ok((await fetch(p.subida.url, { method: 'PUT', headers: p.subida.cabeceras, body: binario })).ok);
    assert.equal((await enviar(`/api/v1/archivos/${borrar}/confirmar`, 'POST')).status, 201);
    assert.equal((await enviar(`/api/v1/archivos/${borrar}`, 'DELETE')).status, 200);
    assert.equal((await enviar(`/api/v1/archivos/${borrar}`, 'DELETE')).status, 200);
    assert.equal((await enviar(`/api/v1/archivos/${borrar}/descarga`)).status, 409);
    assert.equal((await registro.obtener(borrar)).estado, 'BORRADO');
  });
  const evidencia = { fecha: new Date().toISOString(), region, pruebas: resultados, ejemplo, perfil_prueba: titular,
    alcance_autenticacion: 'Emisor efímero local en aplicación de ensayo. Producción conserva auth.leonardoserrate.xyz.' };
  await writeFile('/var/tmp/clb-evidencia-aws.json', JSON.stringify(evidencia, null, 2));
  console.log(JSON.stringify(evidencia));
} finally { await app.close(); dynamo.destroy(); s3.destroy(); }
