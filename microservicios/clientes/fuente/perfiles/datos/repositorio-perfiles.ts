import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

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
}

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
