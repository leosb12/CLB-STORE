import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ColaFotografica, ErrorNoDisponible, ErrorRed, ErrorSesion, ErrorTemporal, type AlmacenSolicitudes, type EstadoRemoto, type ServidorFotografico } from "../fuente/aplicacion/probador-fotografico";
import { ProbadorFotograficoRest } from "../fuente/adaptadores/probador-fotografico-rest";
import { esperaReintento, MAXIMO_FALLOS_SERVIDOR, VERSION_MOTOR, type SolicitudFotografica } from "../fuente/dominio/solicitud-fotografica";

/** Doble de persistencia: misma semántica por titular que IndexedDB. Clona para detectar escrituras no guardadas. */
class AlmacenMemoria implements AlmacenSolicitudes {
  filas = new Map<string, SolicitudFotografica>();
  marcas = new Set<string>();
  async guardar(s: SolicitudFotografica) { this.filas.set(`${s.titular}|${s.clave}`, { ...s }); }
  async obtener(t: string, c: string) { const s = this.filas.get(`${t}|${c}`); return s && { ...s }; }
  async listar(t: string) { return [...this.filas.values()].filter((s) => s.titular === t).map((s) => ({ ...s })); }
  async eliminar(t: string, c: string) { this.filas.delete(`${t}|${c}`); }
  async eliminarConBorrado(t: string, c: string) { if (c !== "*") this.filas.delete(`${t}|${c}`); this.marcas.add(`${t}|${c}`); }
  async borrados(t: string) { return [...this.marcas].filter((m) => m.startsWith(`${t}|`)).map((m) => m.slice(t.length + 1)); }
  async confirmarBorrado(t: string, c: string) { this.marcas.delete(`${t}|${c}`); }
  async borrarTodo() { this.filas.clear(); }
}

/** Doble del servidor: deduplica por clave como `TrabajosProbador`. No es inferencia real. */
class ServidorMemoria implements ServidorFotografico {
  conectado = true;
  envios = 0;
  invalidaciones: string[] = [];
  respuestas: Array<EstadoRemoto | Error> = [];
  async enviar(s: SolicitudFotografica): Promise<EstadoRemoto> {
    if (!this.conectado) throw new ErrorRed("sin red");
    this.envios++;
    const siguiente = this.respuestas.shift();
    if (siguiente instanceof Error) throw siguiente;
    return siguiente ?? { identificador: s.clave, estado: "PROCESANDO" };
  }
  async consultar(clave: string): Promise<EstadoRemoto> {
    if (!this.conectado) throw new ErrorRed("sin red");
    return { identificador: clave, estado: "LISTO" };
  }
  async descargar(): Promise<Blob> { return new Blob(["png"], { type: "image/png" }); }
  async invalidar(clave: string) { if (!this.conectado) throw new ErrorRed("sin red"); this.invalidaciones.push(clave); }
}

const huella = async (d: ArrayBuffer) => createHash("sha256").update(new Uint8Array(d)).digest("hex");
const prenda = { identificador: "p", nombre: "Polera", sku: "SKU", categoría: "polera", imagen: "/ropa.svg", imagenFotografica: "/ropa.png", tallas: ["M"] };
const foto = (texto = "foto") => new Blob([texto], { type: "image/jpeg" });
const ropa = new Blob(["ropa"], { type: "image/png" });

function crear(almacen: AlmacenMemoria, servidor: ServidorMemoria, titular: () => string | null = () => "ana", reloj = { t: 1_000 }) {
  return new ColaFotografica(almacen, servidor, async () => ({ titular: titular(), cabeceras: (titular() ? { Authorization: "Bearer x" } : {}) as Record<string, string> }),
    { huella, ahora: () => reloj.t, azar: () => 0.5, sondeo: async () => undefined });
}

test("cola: sin red guarda la foto, sobrevive al cierre y se envía una sola vez al reconectar", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  servidor.conectado = false;
  const cola = crear(almacen, servidor);
  const s = await cola.encolar(foto(), prenda, ropa);
  await cola.sincronizar();
  const guardada = (await cola.listar())[0]!;
  assert.equal(guardada.estado, "PENDIENTE");
  assert.ok(guardada.persona && guardada.ropa, "la foto queda en el dispositivo");
  assert.ok(guardada.proximo > 1_000, "espera con backoff");
  // «Cerrar y reabrir»: otra instancia sobre el mismo almacén durable.
  servidor.conectado = true;
  const reabierta = crear(almacen, servidor, () => "ana", { t: 10_000_000 });
  await reabierta.sincronizar();
  const lista = (await reabierta.listar())[0]!;
  assert.equal(lista.estado, "LISTO");
  assert.equal(lista.clave, s.clave);
  assert.equal(lista.persona, undefined, "el original se retira al completar");
  assert.equal(servidor.envios, 1);
  // Misma foto y prenda: no se duplica ni se reenvía.
  assert.equal((await reabierta.encolar(foto(), prenda, ropa)).clave, s.clave);
  await reabierta.sincronizar();
  assert.equal(servidor.envios, 1);
});

test("cola: una espera interrumpida (ENVIANDO) se reanuda con la misma clave", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  servidor.conectado = false;
  const s = await crear(almacen, servidor).encolar(foto(), prenda, ropa);
  await almacen.guardar({ ...(await almacen.obtener("ana", s.clave))!, estado: "ENVIANDO", proximo: 0 });
  servidor.conectado = true;
  await crear(almacen, servidor).sincronizar();
  assert.equal((await almacen.obtener("ana", s.clave))!.estado, "LISTO");
});

test("cola: errores temporales reintentan con jitter y se agotan; los definitivos no se repiten", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria(), reloj = { t: 0 };
  const cola = crear(almacen, servidor, () => "ana", reloj);
  servidor.respuestas = Array.from({ length: MAXIMO_FALLOS_SERVIDOR }, () => new ErrorTemporal("GPU sin memoria."));
  const s = await cola.encolar(foto(), prenda, ropa);
  for (let i = 0; i < MAXIMO_FALLOS_SERVIDOR; i++) {
    reloj.t += 120_000;
    await cola.sincronizar();
  }
  const agotada = (await almacen.obtener("ana", s.clave))!;
  assert.equal(agotada.estado, "ERROR");
  assert.match(agotada.mensaje, /Reintentar/);
  assert.ok(agotada.persona, "conserva la foto para reintentar");
  await cola.reintentar(s.clave);
  await cola.sincronizar();
  assert.equal((await almacen.obtener("ana", s.clave))!.estado, "LISTO");
  servidor.respuestas = [{ identificador: "x".repeat(64), estado: "ERROR", mensaje: "La foto debe mostrar una sola persona.", reintentable: false }];
  const otra = await cola.encolar(foto("dos personas"), prenda, ropa);
  servidor.respuestas[0] = { ...servidor.respuestas[0] as EstadoRemoto, identificador: otra.clave };
  await cola.sincronizar();
  const definitiva = (await almacen.obtener("ana", otra.clave))!;
  assert.equal(definitiva.estado, "ERROR");
  assert.match(definitiva.mensaje, /una sola persona/);
});

test("cola: sesión vencida no gasta intentos; cuentas separadas; eliminar invalida en el servidor antes de enviar", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  let titular: string | null = "ana";
  const cola = crear(almacen, servidor, () => titular);
  servidor.respuestas = [new ErrorSesion("Inicia sesión.")];
  const s = await cola.encolar(foto(), prenda, ropa);
  await cola.sincronizar();
  const pendiente = (await almacen.obtener("ana", s.clave))!;
  assert.equal(pendiente.estado, "PENDIENTE");
  assert.equal(pendiente.intentos, 0);
  titular = "bea";
  assert.deepEqual(await cola.listar(), [], "otra cuenta no ve la solicitud");
  await cola.eliminar(s.clave);
  assert.ok(await almacen.obtener("ana", s.clave), "bea no puede borrar lo de ana");
  titular = "ana";
  servidor.conectado = false;
  await cola.eliminar(s.clave);
  assert.equal(await almacen.obtener("ana", s.clave), undefined);
  servidor.conectado = true;
  await cola.encolar(foto("nueva"), prenda, ropa);
  await cola.sincronizar();
  assert.deepEqual(servidor.invalidaciones, [s.clave], "el borrado pendiente se envía al reconectar");
  await cola.borrarDatosLocales();
  assert.equal(almacen.filas.size, 0, "cerrar sesión no deja fotos privadas");
});

test("cola: otro motor recalcula la clave y conserva la foto", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  servidor.conectado = false;
  const s = await crear(almacen, servidor).encolar(foto(), prenda, ropa);
  await almacen.eliminar("ana", s.clave);
  await almacen.guardar({ ...s, clave: "vieja", version: "catvton-anterior" });
  servidor.conectado = true;
  await crear(almacen, servidor).sincronizar();
  const [actual] = await almacen.listar("ana");
  assert.equal(actual!.clave, s.clave);
  assert.equal(actual!.version, VERSION_MOTOR);
  assert.equal(actual!.estado, "LISTO");
});

test("espera de reintento: exponencial con jitter completo y tope de 60 s", () => {
  assert.equal(esperaReintento(1, () => 1), 5_000);
  assert.equal(esperaReintento(20, () => 1), 60_000);
  assert.equal(esperaReintento(3, () => 0), 1_000);
  assert.ok(esperaReintento(4, () => 0.5) <= 20_000);
});

test("REST: clasifica red, servidor temporal, sesión, definitivo e integridad de la descarga", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  let respuesta: () => Response | Promise<Response> = () => { throw new TypeError("Failed to fetch"); };
  Object.defineProperty(globalThis, "fetch", { value: async () => respuesta(), configurable: true });
  const rest = new ProbadorFotograficoRest(), señal = new AbortController().signal, clave = "a".repeat(64);
  try {
    await assert.rejects(rest.consultar(clave, {}, señal), ErrorRed);
    // Caído u ocupado: como la red, no agota la solicitud (no se gastó GPU).
    respuesta = () => Response.json({ mensaje: "Reiniciando" }, { status: 503 });
    await assert.rejects(rest.consultar(clave, {}, señal), ErrorNoDisponible);
    respuesta = () => Response.json({ mensaje: "Ocupado" }, { status: 429 });
    await assert.rejects(rest.consultar(clave, {}, señal), ErrorNoDisponible);
    respuesta = () => new Response(null, { status: 401 });
    await assert.rejects(rest.consultar(clave, {}, señal), ErrorSesion);
    respuesta = () => Response.json({ mensaje: "Foto no apta" }, { status: 422 });
    await assert.rejects(rest.consultar(clave, {}, señal), (e: Error) => !(e instanceof ErrorTemporal) && /no apta/.test(e.message));
    respuesta = () => new Response("png", { headers: { "Content-Type": "image/png", "X-Contenido-SHA256": "0".repeat(64) } });
    await assert.rejects(rest.descargar(clave, {}, señal), ErrorTemporal);
    respuesta = () => new Response("png", { headers: { "Content-Type": "image/png", "X-Contenido-SHA256": createHash("sha256").update("png").digest("hex") } });
    assert.equal(await (await rest.descargar(clave, {}, señal)).text(), "png");
  } finally {
    if (original) Object.defineProperty(globalThis, "fetch", original);
  }
});

test("cola: una sesión entregada tarde avisa a la vista y envía lo pendiente", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  let cuenta: string | null = "ana";
  const reloj = { t: 1_000 };
  servidor.conectado = false;
  const cola = crear(almacen, servidor, () => cuenta, reloj);
  await cola.encolar(foto(), prenda, ropa);
  await cola.sincronizar();
  cuenta = null; // recarga: el shell todavía no restauró la sesión
  assert.deepEqual(await cola.listar(), []);
  let avisos = 0;
  cola.alCambiar(() => avisos++);
  servidor.conectado = true;
  cuenta = "ana";
  reloj.t = 10_000_000; // ya venció la espera de reintento
  cola.sesionCambiada();
  assert.ok(avisos > 0, "la vista vuelve a leer la lista");
  for (let i = 0; i < 20 && servidor.envios === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(servidor.envios, 1);
});

const jean = { identificador: "j", nombre: "Jean", sku: "SKU-J", categoría: "Pantalones", imagen: "/jean.svg", imagenFotografica: "/jean.png", tallas: ["M"] };
const ropaJean = new Blob(["jean"], { type: "image/png" });

test("cola: un conjunto genera primero la prenda de abajo y luego la de arriba sobre su resultado", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  const cola = crear(almacen, servidor);
  const primera = await cola.encolar(foto(), jean, ropaJean, { siguiente: { prenda, ropa } });
  await cola.sincronizar();
  const lista = await cola.listar();
  assert.equal(servidor.envios, 2, "dos pasadas de CatVTON");
  const paso1 = lista.find((s) => s.clave === primera.clave)!;
  const paso2 = lista.find((s) => s.clave === paso1.continuacion)!;
  assert.equal(paso1.estado, "LISTO");
  assert.equal(paso1.siguiente, undefined, "la segunda prenda ya se encoló");
  assert.equal(paso2.estado, "LISTO");
  assert.equal(paso2.prenda.identificador, "p");
  assert.equal(paso2.base?.identificador, "j", "la final recuerda la prenda que ya traía la foto");
});

test("cola: si la página se cerró entre las dos prendas, el conjunto continúa al reabrir", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  const cola = crear(almacen, servidor);
  const primera = await cola.encolar(foto(), jean, ropaJean, { siguiente: { prenda, ropa } });
  // Primera prenda terminada pero la continuación no llegó a encolarse.
  await almacen.guardar({ ...(await almacen.obtener("ana", primera.clave))!, estado: "LISTO", resultado: new Blob(["png"], { type: "image/png" }), persona: undefined, ropa: undefined });
  await crear(almacen, servidor).sincronizar();
  const paso1 = (await almacen.obtener("ana", primera.clave))!;
  assert.ok(paso1.continuacion, "se encoló la segunda prenda");
  assert.equal((await almacen.obtener("ana", paso1.continuacion!))?.estado, "LISTO");
});

test("cola: pedir el conjunto mientras la primera prenda se envía no pierde la segunda", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  let cola!: ColaFotografica, unaVez = true;
  // Durante la primera espera de generación el usuario agrega la polera y vuelve a pulsar «Generar».
  cola = new ColaFotografica(almacen, servidor, async () => ({ titular: "ana", cabeceras: { Authorization: "Bearer x" } }), {
    huella, ahora: () => 1_000, azar: () => 0.5,
    sondeo: async () => { if (unaVez) { unaVez = false; await cola.encolar(foto(), jean, ropaJean, { siguiente: { prenda, ropa } }); } },
  });
  await cola.encolar(foto(), jean, ropaJean);
  await cola.sincronizar();
  const lista = await cola.listar();
  assert.equal(servidor.envios, 2, "se generó también la polera");
  assert.ok(lista.some((s) => s.base?.identificador === "j" && s.prenda.identificador === "p" && s.estado === "LISTO"));
});

test("cola: borrar la imagen final de un conjunto borra también el paso intermedio; pedir de nuevo la primera sola la muestra", async () => {
  const almacen = new AlmacenMemoria(), servidor = new ServidorMemoria();
  const cola = crear(almacen, servidor);
  const primera = await cola.encolar(foto(), jean, ropaJean, { siguiente: { prenda, ropa } });
  await cola.sincronizar();
  const final = (await almacen.obtener("ana", primera.clave))!.continuacion!;
  // Pedir el jean solo con la misma foto: la imagen intermedia pasa a verse (sin continuación) y no se regenera.
  const sola = await cola.encolar(foto(), jean, ropaJean);
  assert.equal(sola.clave, primera.clave);
  assert.equal(sola.continuacion, undefined);
  assert.equal(servidor.envios, 2);
  // Vuelve a ser intermedia y se borra en cascada con la final.
  await almacen.guardar({ ...(await almacen.obtener("ana", primera.clave))!, continuacion: final });
  await cola.eliminar(final);
  assert.equal((await cola.listar()).length, 0, "no quedan imágenes huérfanas");
  assert.ok(servidor.invalidaciones.includes(primera.clave) && servidor.invalidaciones.includes(final), "también se pide borrar ambas en CLB");
});
