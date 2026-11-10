import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Archivo, RegistroArchivos, AlmacenArchivos } from "./contratos-datos.js";

export class RegistroDynamoArchivos implements RegistroArchivos {
  private readonly documentos: DynamoDBDocumentClient;
  constructor(cliente: DynamoDBClient, private readonly tabla: string) {
    this.documentos = DynamoDBDocumentClient.from(cliente, { marshallOptions: { removeUndefinedValues: true } });
  }
  async obtener(id: string): Promise<Archivo | null> {
    const { Item } = await this.documentos.send(new GetCommand({ TableName: this.tabla, Key: { identificador: id }, ConsistentRead: true }));
    return Item as Archivo ?? null;
  }
  async crear(archivo: Archivo) {
    try { await this.documentos.send(new PutCommand({ TableName: this.tabla, Item: archivo, ConditionExpression: "attribute_not_exists(identificador)" })); }
    catch (error) { if ((error as Error).name !== "ConditionalCheckFailedException") throw error; }
  }
  async estado(id: string, estado: Archivo["estado"]) {
    try {
      await this.documentos.send(new UpdateCommand({ TableName: this.tabla, Key: { identificador: id },
        UpdateExpression: "SET #estado = :estado", ExpressionAttributeNames: { "#estado": "estado" },
        ExpressionAttributeValues: { ":estado": estado, ...(estado === "DISPONIBLE" ? { ":pendiente": "PENDIENTE", ":disponible": "DISPONIBLE" } : {}) },
        ConditionExpression: estado === "DISPONIBLE" ? "#estado IN (:pendiente, :disponible)" : "attribute_exists(identificador)" }));
    } catch (error) {
      if ((error as Error).name === "ConditionalCheckFailedException") throw new ConflictException({ mensaje: "El archivo cambió de estado." });
      throw error;
    }
  }
  async listar(titular: string, cursor?: string) {
    let inicio;
    if (cursor) {
      try {
        inicio = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (inicio.titular !== titular || typeof inicio.identificador !== "string" || typeof inicio.fecha !== "string") throw new Error();
      } catch { throw new UnprocessableEntityException({ mensaje: "Cursor de archivos inválido." }); }
    }
    const pagina = await this.documentos.send(new QueryCommand({ TableName: this.tabla, IndexName: "clb_por_titular",
      KeyConditionExpression: "titular = :titular", ExpressionAttributeValues: { ":titular": titular }, Limit: 50,
      ScanIndexForward: false, ExclusiveStartKey: inicio }));
    return { archivos: (pagina.Items ?? []) as Archivo[], ...(pagina.LastEvaluatedKey ? { cursor: Buffer.from(JSON.stringify(pagina.LastEvaluatedKey)).toString("base64url") } : {}) };
  }
}

export class AlmacenS3 implements AlmacenArchivos {
  constructor(private readonly cliente: S3Client, private readonly bucket: string) {}
  async subida(archivo: Archivo) {
    const checksum = Buffer.from(archivo.sha256, "hex").toString("base64");
    const comando = new PutObjectCommand({ Bucket: this.bucket, Key: archivo.objeto, ContentType: archivo.mime,
      ContentLength: archivo.bytes, ChecksumSHA256: checksum, IfNoneMatch: "*",
      Metadata: { "clb-referencia": archivo.identificador, "clb-origen": archivo.origen } });
    const url = await getSignedUrl(this.cliente, comando, { expiresIn: 300,
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      signableHeaders: new Set(["content-type", "if-none-match", "x-amz-checksum-sha256"]) });
    return { url, cabeceras: { "content-type": archivo.mime, "if-none-match": "*", "x-amz-checksum-sha256": checksum } };
  }
  async comprobar(archivo: Archivo) {
    const objeto = await this.cliente.send(new HeadObjectCommand({ Bucket: this.bucket, Key: archivo.objeto, ChecksumMode: "ENABLED" }));
    if (objeto.ContentLength !== archivo.bytes || objeto.ContentType !== archivo.mime ||
      objeto.ChecksumSHA256 !== Buffer.from(archivo.sha256, "hex").toString("base64") || objeto.Metadata?.["clb-referencia"] !== archivo.identificador)
      throw new ConflictException({ mensaje: "El objeto no coincide con el tamaño, tipo, referencia o SHA-256 registrado.", código: "ARCHIVO_INCOMPLETO" });
  }
  descarga(archivo: Archivo) {
    return getSignedUrl(this.cliente, new GetObjectCommand({ Bucket: this.bucket, Key: archivo.objeto,
      ResponseContentDisposition: `attachment; filename="${archivo.objeto.split("/").pop()}"` }), { expiresIn: 300 });
  }
  async borrar(archivo: Archivo) { await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: archivo.objeto })); }
}
