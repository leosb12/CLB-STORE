import { randomUUID, timingSafeEqual } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  REPOSITORIO_NOTIFICACIONES, huella,
  type Envio, type EstadoEnvio, type Preferencias, type RepositorioNotificaciones, type TipoEvento,
} from "../datos/repositorio-notificaciones.js";
import { PROVEEDOR_CORREO, PROVEEDOR_PUSH, type Mensaje, type ProveedorCorreo, type ProveedorPush, type ResultadoEnvio } from "../datos/proveedores.js";

export interface EventoPedido { evento: string; tipo: TipoEvento; cliente: string; pedido: string }

/** Transaccionales: si la persona nunca eligió, ambos canales están activos (el push además requiere permiso del sistema). */
export const PREFERENCIAS_POR_DEFECTO: Preferencias = { push: true, correo: true, versión: 0 };
export const MAXIMO_INTENTOS = 5;
const RECLAMO_MS = 120_000;
// Resend deduplica la Idempotency-Key durante 24 h: después no se reintenta para no arriesgar un correo duplicado.
const VENTANA_CORREO_MS = 23 * 3_600_000;

export const RELOJ = Symbol("Reloj");

function mensaje(envio: Envio): Mensaje {
  const corto = envio.pedido.slice(0, 8).toUpperCase();
  const confirmado = envio.tipo === "pedido_confirmado";
  return {
    titulo: `CLB Store · Pedido #${corto} ${confirmado ? "confirmado" : "cancelado"}`,
    cuerpo: confirmado
      ? `Tu pedido #${corto} fue confirmado. Puedes ver el detalle y el comprobante en «Mis pedidos».`
      : `Tu pedido #${corto} fue cancelado. Revisa el motivo en «Mis pedidos».`,
    datos: { destino: "pedidos", pedido: envio.pedido },
    clave: `${envio.evento}:${envio.canal === "CORREO" ? "correo" : "push"}`,
  };
}

const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

@Injectable()
export class ServicioNotificaciones {
  constructor(
    @Inject(REPOSITORIO_NOTIFICACIONES) private readonly repositorio: RepositorioNotificaciones,
    @Inject(PROVEEDOR_PUSH) private readonly push: ProveedorPush,
    @Inject(PROVEEDOR_CORREO) private readonly correo: ProveedorCorreo,
    @Inject(RELOJ) private readonly reloj: () => Date,
  ) {}

  // --- Titular (JWT) -------------------------------------------------------------------------------------------------

  /** El correo viene solo del token verificado (nunca del cuerpo); se refresca cada vez que el titular consulta. */
  async registrarContacto(sub: string, correo: string | undefined, nombre?: string): Promise<boolean> {
    // El nombre de la cuenta se copia al iniciar sesión (mismo momento que el correo), solo si cambió.
    if (nombre && (await this.repositorio.nombreCuenta(sub)) !== nombre) await this.repositorio.guardarNombreCuenta(sub, nombre);
    if (!correo) return false;
    if ((await this.repositorio.contacto(sub)) !== correo) await this.repositorio.guardarContacto(sub, correo);
    return true;
  }

  /** Registra el correo del token (si trae) y dice si Clientes conoce alguno para este titular. */
  async correoDisponible(sub: string, correo: string | undefined, nombre?: string) {
    return await this.registrarContacto(sub, correo, nombre) || (await this.repositorio.contacto(sub)) !== null;
  }

  async preferencias(sub: string, correo: string | undefined, nombre?: string) {
    const correoDisponible = await this.correoDisponible(sub, correo, nombre);
    return { ...((await this.repositorio.preferencias(sub)) ?? PREFERENCIAS_POR_DEFECTO), correo_disponible: correoDisponible };
  }

  /**
   * Cambio con versión esperada. Con Idempotency-Key, repetir la misma clave y el mismo cuerpo tras una respuesta perdida
   * devuelve lo ya guardado (no un falso conflicto); la misma clave con otro cuerpo se rechaza sin aplicar nada.
   */
  async guardarPreferencias(sub: string, cambios: { push: boolean; correo: boolean }, versiónEsperada: number, clave?: string) {
    const idempotencia = clave ? { clave, huella: huella(JSON.stringify([cambios.push, cambios.correo, versiónEsperada])) } : undefined;
    const guardadas = await this.repositorio.guardarPreferencias(sub, cambios, versiónEsperada, idempotencia);
    if (guardadas) return guardadas;
    const ultimo = idempotencia && await this.repositorio.ultimoCambioPreferencias(sub);
    if (ultimo && ultimo.clave === idempotencia!.clave) {
      if (ultimo.huella !== idempotencia!.huella)
        throw new ConflictException({ mensaje: "Esta Idempotency-Key ya se usó con otro cambio. No se aplicó nada.", código: "CONFLICTO_IDEMPOTENCIA" });
      return (await this.repositorio.preferencias(sub))!;
    }
    throw new ConflictException({ mensaje: "Las preferencias cambiaron en otro dispositivo.", código: "CONFLICTO_VERSION",
      actual: (await this.repositorio.preferencias(sub)) ?? PREFERENCIAS_POR_DEFECTO });
  }

  /**
   * Vincula la instalación con la cuenta del token. Si la instalación ya existe, hay que probar el mismo secreto: así nadie
   * con otra cuenta puede apropiarse de un teléfono ajeno, pero el mismo teléfono sí pasa de A a B al cambiar de sesión.
   */
  async vincular(sub: string, instalacion: string, token: string, secreto: string): Promise<void> {
    const actual = await this.repositorio.instalacion(instalacion);
    if (actual && !iguales(actual.hash_secreto, huella(secreto)))
      throw new ForbiddenException({ mensaje: "La instalación no coincide con su secreto.", código: "INSTALACION_AJENA" });
    if (!(await this.repositorio.vincular({ instalacion, sub, token, hash_secreto: huella(secreto) })))
      throw new ConflictException({ mensaje: "La instalación cambió a la vez; reintenta.", código: "CONFLICTO_VINCULO" });
  }

  /** Desvinculación sin sesión (cierre de sesión sin red): basta el secreto de la instalación. Idempotente. */
  async desvincular(instalacion: string, secreto: string): Promise<void> {
    const actual = await this.repositorio.instalacion(instalacion);
    if (!actual) return;
    if (!iguales(actual.hash_secreto, huella(secreto)))
      throw new ForbiddenException({ mensaje: "La instalación no coincide con su secreto.", código: "INSTALACION_AJENA" });
    await this.repositorio.desvincular(instalacion);
  }

  // --- Integración (n8n, rol servicio) --------------------------------------------------------------------------------

  /** Deja cada evento registrado de forma durable (una fila por canal) antes de que n8n avance su cursor. Idempotente. */
  async registrar(eventos: EventoPedido[]): Promise<{ registrados: number; repetidos: number }> {
    let repetidos = 0;
    const ahora = this.reloj().toISOString();
    for (const evento of eventos) {
      if ((await this.repositorio.envios(evento.evento)).length) { repetidos++; continue; }
      const preferencias = (await this.repositorio.preferencias(evento.cliente)) ?? PREFERENCIAS_POR_DEFECTO;
      const fila = (canal: string, estado: EstadoEnvio): Envio => ({ ...evento, canal, estado, intentos: 0, proximo_intento: ahora,
        primer_intento: null, reclamo: null, reclamado_hasta: null, codigo_error: null, actualizado: ahora });
      const filas = [fila("CORREO", !preferencias.correo ? "OMITIDO_PREFERENCIA"
        : (await this.repositorio.contacto(evento.cliente)) ? "PENDIENTE" : "OMITIDO_SIN_DESTINO")];
      const dispositivos = preferencias.push ? await this.repositorio.dispositivos(evento.cliente) : [];
      if (!preferencias.push) filas.push(fila("PUSH", "OMITIDO_PREFERENCIA"));
      else if (!dispositivos.length) filas.push(fila("PUSH", "OMITIDO_SIN_DESTINO"));
      else filas.push(...dispositivos.map(d => fila(`PUSH#${d.instalacion}`, "PENDIENTE")));
      await this.repositorio.crearEnvios(filas);
    }
    return { registrados: eventos.length - repetidos, repetidos };
  }

  /** Envía lo pendiente: reclamo atómico con vencimiento, cada canal por su lado, reintentos acotados con espera creciente. */
  async procesar(limite: number): Promise<Record<string, number>> {
    const resumen: Record<string, number> = {};
    const ahora = this.reloj();
    for (const envio of await this.repositorio.elegibles(ahora.toISOString(), limite)) {
      const reclamo = randomUUID();
      if (!(await this.repositorio.reclamar(envio, reclamo, new Date(ahora.getTime() + RECLAMO_MS).toISOString(), ahora.toISOString()))) continue;
      const intentos = envio.intentos + 1;
      const resultado = await this.intentar(envio);
      const cambios = this.siguiente(envio, intentos, resultado);
      if (await this.repositorio.finalizar(envio, reclamo, { ...cambios, reclamo: null, reclamado_hasta: null, actualizado: this.reloj().toISOString() }))
        resumen[cambios.estado!] = (resumen[cambios.estado!] ?? 0) + 1;
    }
    return resumen;
  }

  private async intentar(envio: Envio): Promise<ResultadoEnvio | "SIN_DESTINO" | "VENCIDO"> {
    const texto = mensaje(envio);
    if (envio.canal === "CORREO") {
      if (envio.primer_intento && this.reloj().getTime() - Date.parse(envio.primer_intento) > VENTANA_CORREO_MS) return "VENCIDO";
      const correo = await this.repositorio.contacto(envio.cliente);
      return correo ? this.correo.enviar(correo, texto) : "SIN_DESTINO";
    }
    const instalacion = envio.canal.slice("PUSH#".length);
    const dispositivo = await this.repositorio.instalacion(instalacion);
    // Reasignada a otra cuenta o desvinculada desde el registro: nunca se envía al titular equivocado.
    if (!dispositivo || dispositivo.sub !== envio.cliente) return "SIN_DESTINO";
    const resultado = await this.push.enviar(dispositivo.token, texto);
    if (!resultado.ok && resultado.tipo === "token_invalido") await this.repositorio.desvincular(instalacion);
    return resultado;
  }

  private siguiente(envio: Envio, intentos: number, resultado: ResultadoEnvio | "SIN_DESTINO" | "VENCIDO"): Partial<Envio> {
    if (resultado === "SIN_DESTINO") return { estado: "OMITIDO_SIN_DESTINO", codigo_error: null };
    if (resultado === "VENCIDO") return { estado: "FALLIDO_DEFINITIVO", codigo_error: "VENCIDO" };
    if (resultado.ok) return { estado: "ENVIADO", codigo_error: null };
    if (resultado.tipo === "token_invalido") return { estado: "OMITIDO_TOKEN_INVALIDO", codigo_error: resultado.codigo };
    if (resultado.tipo === "definitivo" || intentos >= MAXIMO_INTENTOS) return { estado: "FALLIDO_DEFINITIVO", codigo_error: resultado.codigo };
    const espera = 60_000 * 2 ** (intentos - 1); // 1, 2, 4, 8 min
    return { estado: "REINTENTAR", codigo_error: resultado.codigo, proximo_intento: new Date(this.reloj().getTime() + espera).toISOString() };
  }
}
