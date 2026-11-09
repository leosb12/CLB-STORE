import { createHash } from "node:crypto";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

export type TipoEvento = "pedido_confirmado" | "pedido_cancelado";
export type EstadoEnvio = "PENDIENTE" | "ENVIANDO" | "REINTENTAR" | "ENVIADO" | "FALLIDO_DEFINITIVO"
  | "OMITIDO_PREFERENCIA" | "OMITIDO_SIN_DESTINO" | "OMITIDO_TOKEN_INVALIDO";

/** Una fila por evento y canal; el push tiene una fila por instalación (`PUSH#<instalación>`). Sin correo ni token. */
export interface Envio {
  evento: string;
  canal: string;
  cliente: string;
  tipo: TipoEvento;
  pedido: string;
  estado: EstadoEnvio;
  intentos: number;
  proximo_intento: string;
  primer_intento: string | null;
  reclamo: string | null;
  reclamado_hasta: string | null;
  codigo_error: string | null;
  actualizado: string;
}

export interface Preferencias { push: boolean; correo: boolean; versión: number }

/** Vínculo instalación → cuenta. Una instalación pertenece a una sola cuenta; un token, a una sola instalación. */
export interface Dispositivo { instalacion: string; sub: string; token: string; hash_secreto: string; generacion: number }

export interface RepositorioNotificaciones {
  preferencias(sub: string): Promise<Preferencias | null>;
  /** Guarda si la versión vigente es la esperada (0 = nunca guardadas); null si otra edición ganó. La clave y la huella
   * del cambio quedan junto a las preferencias para reconocer el reintento de una respuesta perdida. */
  guardarPreferencias(sub: string, cambios: { push: boolean; correo: boolean }, versiónEsperada: number,
    idempotencia?: { clave: string; huella: string }): Promise<Preferencias | null>;
  /** Clave y huella del último cambio aplicado (null si no hay o no traía clave). */
  ultimoCambioPreferencias(sub: string): Promise<{ clave: string; huella: string } | null>;
  contacto(sub: string): Promise<string | null>;
  /** Nombre de la cuenta (claim `name` verificado), en `PERFIL#sub / CUENTA`; lo lee el contrato interno de nombres. */
  nombreCuenta(sub: string): Promise<string | null>;
  guardarNombreCuenta(sub: string, nombre: string): Promise<void>;
  guardarContacto(sub: string, correo: string): Promise<void>;
  instalacion(id: string): Promise<Dispositivo | null>;
  /** Reasigna la instalación (y su token) a `sub` de forma atómica; false si otra escritura cambió el vínculo a la vez. */
  vincular(dispositivo: Omit<Dispositivo, "generacion">): Promise<boolean>;
  desvincular(id: string): Promise<void>;
  dispositivos(sub: string): Promise<Dispositivo[]>;
  envios(evento: string): Promise<Envio[]>;
  /** Crea las filas que aún no existen (idempotente por evento y canal). */
  crearEnvios(envios: Envio[]): Promise<void>;
  /** Pendientes o a reintentar con plazo cumplido, y ENVIANDO con el reclamo vencido (caída del procesador). */
  elegibles(ahora: string, limite: number): Promise<Envio[]>;
  reclamar(envio: Envio, reclamo: string, hasta: string, ahora: string): Promise<boolean>;
  /** Guarda el resultado solo si el reclamo sigue siendo el propio. */
  finalizar(envio: Envio, reclamo: string, cambios: Partial<Envio>): Promise<boolean>;
}

export const REPOSITORIO_NOTIFICACIONES = Symbol("RepositorioNotificaciones");

export const huella = (texto: string) => createHash("sha256").update(texto).digest("hex");
const ELEGIBLE = "(#e IN (:pendiente, :reintentar) AND proximo_intento <= :ahora) OR (#e = :enviando AND reclamado_hasta < :ahora)";
const valoresElegible = (ahora: string) => ({ ":pendiente": "PENDIENTE", ":reintentar": "REINTENTAR", ":enviando": "ENVIANDO", ":ahora": ahora });

export class RepositorioNotificacionesDynamoDB implements RepositorioNotificaciones {
  private readonly documentos: DynamoDBDocumentClient;

  constructor(cliente: DynamoDBClient, private readonly tabla: string) {
    this.documentos = DynamoDBDocumentClient.from(cliente, { marshallOptions: { removeUndefinedValues: true } });
  }

  private async leer<T>(pk: string, sk: string): Promise<T | null> {
    const { Item } = await this.documentos.send(new GetCommand({ TableName: this.tabla, Key: { pk, sk }, ConsistentRead: true }));
    if (!Item) return null;
    const { pk: _pk, sk: _sk, ...resto } = Item;
    return resto as T;
  }

  async preferencias(sub: string) {
    const fila = await this.leer<Preferencias>(`PERFIL#${sub}`, "NOTIF#PREFERENCIAS");
    return fila && { push: fila.push, correo: fila.correo, versión: fila.versión };
  }

  async ultimoCambioPreferencias(sub: string) {
    const fila = await this.leer<{ clave?: string; huella?: string }>(`PERFIL#${sub}`, "NOTIF#PREFERENCIAS");
    return fila?.clave && fila.huella ? { clave: fila.clave, huella: fila.huella } : null;
  }

  async guardarPreferencias(sub: string, cambios: { push: boolean; correo: boolean }, versiónEsperada: number,
    idempotencia?: { clave: string; huella: string }) {
    const nuevas: Preferencias = { ...cambios, versión: versiónEsperada + 1 };
    try {
      await this.documentos.send(new PutCommand({
        TableName: this.tabla, Item: { pk: `PERFIL#${sub}`, sk: "NOTIF#PREFERENCIAS", ...nuevas, ...idempotencia },
        ...(versiónEsperada === 0
          ? { ConditionExpression: "attribute_not_exists(pk)" }
          : { ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "versión" }, ExpressionAttributeValues: { ":v": versiónEsperada } }),
      }));
      return nuevas;
    } catch (error) {
      if ((error as Error)?.name === "ConditionalCheckFailedException") return null;
      throw error;
    }
  }

  async nombreCuenta(sub: string) {
    return (await this.leer<{ nombre: string }>(`PERFIL#${sub}`, "CUENTA"))?.nombre ?? null;
  }

  async guardarNombreCuenta(sub: string, nombre: string) {
    await this.documentos.send(new PutCommand({ TableName: this.tabla, Item: { pk: `PERFIL#${sub}`, sk: "CUENTA", nombre } }));
  }

  async contacto(sub: string) {
    return (await this.leer<{ correo: string }>(`PERFIL#${sub}`, "CONTACTO"))?.correo ?? null;
  }

  async guardarContacto(sub: string, correo: string) {
    await this.documentos.send(new PutCommand({ TableName: this.tabla, Item: { pk: `PERFIL#${sub}`, sk: "CONTACTO", correo } }));
  }

  instalacion(id: string) {
    return this.leer<Dispositivo>(`INSTALACION#${id}`, "DISPOSITIVO");
  }

  async vincular(nuevo: Omit<Dispositivo, "generacion">): Promise<boolean> {
    const actual = await this.instalacion(nuevo.instalacion);
    const dueñoToken = await this.leer<{ instalacion: string }>(`TOKEN#${huella(nuevo.token)}`, "TOKEN");
    const otra = dueñoToken && dueñoToken.instalacion !== nuevo.instalacion ? await this.instalacion(dueñoToken.instalacion) : null;
    const operaciones: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
      { Put: { TableName: this.tabla, Item: { pk: `INSTALACION#${nuevo.instalacion}`, sk: "DISPOSITIVO", ...nuevo, generacion: (actual?.generacion ?? 0) + 1 },
        ...(actual
          ? { ConditionExpression: "generacion = :g", ExpressionAttributeValues: { ":g": actual.generacion } }
          : { ConditionExpression: "attribute_not_exists(pk)" }) } },
      { Put: { TableName: this.tabla, Item: { pk: `PERFIL#${nuevo.sub}`, sk: `DISPOSITIVO#${nuevo.instalacion}`, instalacion: nuevo.instalacion } } },
      { Put: { TableName: this.tabla, Item: { pk: `TOKEN#${huella(nuevo.token)}`, sk: "TOKEN", instalacion: nuevo.instalacion } } },
    ];
    if (actual && actual.sub !== nuevo.sub)
      operaciones.push({ Delete: { TableName: this.tabla, Key: { pk: `PERFIL#${actual.sub}`, sk: `DISPOSITIVO#${nuevo.instalacion}` } } });
    if (actual && actual.token !== nuevo.token)
      operaciones.push({ Delete: { TableName: this.tabla, Key: { pk: `TOKEN#${huella(actual.token)}`, sk: "TOKEN" } } });
    if (otra) // el mismo token figuraba en otra instalación (reinstalación): ese vínculo deja de existir
      operaciones.push({ Delete: { TableName: this.tabla, Key: { pk: `INSTALACION#${otra.instalacion}`, sk: "DISPOSITIVO" } } },
        { Delete: { TableName: this.tabla, Key: { pk: `PERFIL#${otra.sub}`, sk: `DISPOSITIVO#${otra.instalacion}` } } });
    try {
      await this.documentos.send(new TransactWriteCommand({ TransactItems: operaciones }));
      return true;
    } catch (error) {
      if ((error as Error)?.name === "TransactionCanceledException") return false;
      throw error;
    }
  }

  async desvincular(id: string) {
    const actual = await this.instalacion(id);
    if (!actual) return;
    await this.documentos.send(new TransactWriteCommand({ TransactItems: [
      { Delete: { TableName: this.tabla, Key: { pk: `INSTALACION#${id}`, sk: "DISPOSITIVO" },
        ConditionExpression: "generacion = :g", ExpressionAttributeValues: { ":g": actual.generacion } } },
      { Delete: { TableName: this.tabla, Key: { pk: `PERFIL#${actual.sub}`, sk: `DISPOSITIVO#${id}` } } },
      { Delete: { TableName: this.tabla, Key: { pk: `TOKEN#${huella(actual.token)}`, sk: "TOKEN" } } },
    ] })).catch(error => { if ((error as Error)?.name !== "TransactionCanceledException") throw error; });
  }

  async dispositivos(sub: string) {
    const { Items = [] } = await this.documentos.send(new QueryCommand({
      TableName: this.tabla, KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `PERFIL#${sub}`, ":sk": "DISPOSITIVO#" }, ConsistentRead: true,
    }));
    const vinculos = await Promise.all(Items.map(item => this.instalacion(String(item["instalacion"]))));
    // El índice puede quedar atrás de una reasignación: manda el registro autoritativo de la instalación.
    return vinculos.filter((d): d is Dispositivo => d !== null && d.sub === sub);
  }

  async envios(evento: string) {
    const { Items = [] } = await this.documentos.send(new QueryCommand({
      TableName: this.tabla, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": `ENVIO#${evento}` }, ConsistentRead: true,
    }));
    return Items.map(({ pk: _pk, sk: _sk, ...resto }) => resto as Envio);
  }

  async crearEnvios(envios: Envio[]) {
    // Sin primer_intento: un atributo NULL «existe» y if_not_exists no lo completaría en el primer reclamo.
    await Promise.all(envios.map(({ primer_intento: _primero, ...envio }) => this.documentos.send(new PutCommand({
      TableName: this.tabla, Item: { pk: `ENVIO#${envio.evento}`, sk: envio.canal, ...envio }, ConditionExpression: "attribute_not_exists(pk)",
    })).catch(error => { if ((error as Error)?.name !== "ConditionalCheckFailedException") throw error; })));
  }

  async elegibles(ahora: string, limite: number) {
    // ponytail: Scan con filtro sobre la tabla del servicio; con volumen real, un GSI disperso por estado pendiente.
    const encontrados: Envio[] = [];
    let desde: Record<string, unknown> | undefined;
    do {
      const pagina = await this.documentos.send(new ScanCommand({
        TableName: this.tabla, ExclusiveStartKey: desde,
        FilterExpression: `begins_with(pk, :envio) AND (${ELEGIBLE})`,
        ExpressionAttributeNames: { "#e": "estado" }, ExpressionAttributeValues: { ":envio": "ENVIO#", ...valoresElegible(ahora) },
      }));
      for (const { pk: _pk, sk: _sk, ...resto } of pagina.Items ?? []) encontrados.push(resto as Envio);
      desde = pagina.LastEvaluatedKey;
    } while (desde && encontrados.length < limite);
    return encontrados.sort((a, b) => a.proximo_intento.localeCompare(b.proximo_intento)).slice(0, limite);
  }

  async reclamar(envio: Envio, reclamo: string, hasta: string, ahora: string) {
    try {
      await this.documentos.send(new UpdateCommand({
        TableName: this.tabla, Key: { pk: `ENVIO#${envio.evento}`, sk: envio.canal },
        ConditionExpression: ELEGIBLE,
        UpdateExpression: "SET #e = :enviandoNuevo, reclamo = :r, reclamado_hasta = :h, intentos = intentos + :uno, "
          + "primer_intento = if_not_exists(primer_intento, :ahora), actualizado = :ahora",
        ExpressionAttributeNames: { "#e": "estado" },
        ExpressionAttributeValues: { ...valoresElegible(ahora), ":enviandoNuevo": "ENVIANDO", ":r": reclamo, ":h": hasta, ":uno": 1 },
      }));
      return true;
    } catch (error) {
      if ((error as Error)?.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async finalizar(envio: Envio, reclamo: string, cambios: Partial<Envio>) {
    const campos = Object.entries(cambios).filter(([clave]) => !["evento", "canal"].includes(clave));
    try {
      await this.documentos.send(new UpdateCommand({
        TableName: this.tabla, Key: { pk: `ENVIO#${envio.evento}`, sk: envio.canal },
        ConditionExpression: "reclamo = :mio",
        UpdateExpression: "SET " + campos.map((_, i) => `#c${i} = :v${i}`).join(", "),
        ExpressionAttributeNames: Object.fromEntries(campos.map(([clave], i) => [`#c${i}`, clave])),
        ExpressionAttributeValues: { ":mio": reclamo, ...Object.fromEntries(campos.map(([, valor], i) => [`:v${i}`, valor])) },
      }));
      return true;
    } catch (error) {
      if ((error as Error)?.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }
}
