import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export interface Medidas {
  altura_cm?: number;
  peso_kg?: number;
  pecho_cm?: number;
  cintura_cm?: number;
  cadera_cm?: number;
}

/** Perfil editable por su titular (CU01.4); las medidas alimentan la recomendación de talla (fase 8). */
export interface Perfil {
  identificador_cliente: string;
  nombre: string;
  teléfono: string | null;
  medidas: Medidas;
  versión: number;
  fecha_actualización: string;
}

export interface RepositorioPerfiles {
  perfil(cliente: string): Promise<Perfil | null>;
  /** Guarda solo si la versión almacenada es la esperada (0 = aún no existe); false si otra edición ganó. */
  guardar(perfil: Perfil, versiónEsperada: number): Promise<boolean>;
  /** Nombre visible de cada cliente: el del perfil editado por su titular o, si no lo editó, el de su cuenta. */
  nombres(clientes: string[]): Promise<NombreCliente[]>;
}

export interface NombreCliente { cliente: string; nombre: string | null; origen: "PERFIL" | "CUENTA" | null }

export const REPOSITORIO_PERFILES = Symbol("RepositorioPerfiles");

export class RepositorioPerfilesDynamoDB implements RepositorioPerfiles {
  private readonly documentos: DynamoDBDocumentClient;

  constructor(cliente: DynamoDBClient, private readonly tabla: string) {
    this.documentos = DynamoDBDocumentClient.from(cliente);
  }

  async perfil(cliente: string): Promise<Perfil | null> {
    const { Item } = await this.documentos.send(new GetCommand({ TableName: this.tabla, Key: { pk: `PERFIL#${cliente}`, sk: "PERFIL" }, ConsistentRead: true }));
    if (!Item) return null;
    const { pk: _pk, sk: _sk, ...perfil } = Item;
    return perfil as Perfil;
  }

  async nombres(clientes: string[]): Promise<NombreCliente[]> {
    // ponytail: un BatchGet de hasta 200 claves sin reintentar UnprocessedKeys; con carga real, reintentar las pendientes.
    const claves = clientes.flatMap(c => [{ pk: `PERFIL#${c}`, sk: "PERFIL" }, { pk: `PERFIL#${c}`, sk: "CUENTA" }]);
    const { Responses } = await this.documentos.send(new BatchGetCommand({ RequestItems: { [this.tabla]: { Keys: claves, ConsistentRead: true } } }));
    const filas = Responses?.[this.tabla] ?? [];
    return clientes.map((cliente): NombreCliente => {
      const de = (sk: string) => filas.find(f => f["pk"] === `PERFIL#${cliente}` && f["sk"] === sk)?.["nombre"] as string | undefined;
      const perfil = de("PERFIL")?.trim(), cuenta = de("CUENTA")?.trim();
      return perfil ? { cliente, nombre: perfil, origen: "PERFIL" } : cuenta ? { cliente, nombre: cuenta, origen: "CUENTA" } : { cliente, nombre: null, origen: null };
    });
  }

  async guardar(perfil: Perfil, versiónEsperada: number): Promise<boolean> {
    try {
      await this.documentos.send(new PutCommand({
        TableName: this.tabla, Item: { pk: `PERFIL#${perfil.identificador_cliente}`, sk: "PERFIL", ...perfil },
        ...(versiónEsperada === 0
          ? { ConditionExpression: "attribute_not_exists(pk)" }
          : { ConditionExpression: "#version = :esperada", ExpressionAttributeNames: { "#version": "versión" }, ExpressionAttributeValues: { ":esperada": versiónEsperada } }),
      }));
      return true;
    } catch (error) {
      if ((error as Error)?.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }
}
