import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, ResourceNotFoundException,
  TransactionCanceledException, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand,
  type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { configuracion } from "../../configuracion.js";
import type { Movimiento, MovimientosDelPedido, RegistroClave, RepositorioFidelizacion } from "./repositorio-fidelizacion.js";

type Operacion = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export function crearClienteDynamoDB(): DynamoDBClient {
  const { dynamodb } = configuracion;
  return new DynamoDBClient({
    endpoint: dynamodb.endpoint, region: dynamodb.region, maxAttempts: 2,
    // Tiempos acotados para que /salud responda DEGRADADO en vez de quedar esperando.
    requestHandler: { connectionTimeout: 2000, requestTimeout: 3000 },
    // Sin credenciales explícitas fuera de local: el SDK usa su cadena estándar (rol IAM en cloud).
    credentials: dynamodb.identificador && dynamodb.clave ? { accessKeyId: dynamodb.identificador, secretAccessKey: dynamodb.clave } : undefined,
  });
}

const ÍNDICE_CLIENTE = "clb_por_cliente";

// Tabla única:
//  PEDIDO#id + ACREDITACION|REVERSA → movimientos, únicos por pedido; el índice clb_por_cliente los lista por cliente.
//  CLIENTE#id + SALDO               → saldo acumulado.
//  CLAVE#uuid + CLAVE               → huella y resultado de cada Idempotency-Key.
export class RepositorioDynamoDB implements RepositorioFidelizacion {
  private readonly documentos: DynamoDBDocumentClient;

  constructor(private readonly cliente: DynamoDBClient, private readonly tabla: string) {
    this.documentos = DynamoDBDocumentClient.from(cliente);
  }

  async asegurarTabla(): Promise<void> {
    try {
      await this.cliente.send(new DescribeTableCommand({ TableName: this.tabla }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
      await this.cliente.send(new CreateTableCommand({
        TableName: this.tabla, BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" },
          { AttributeName: "identificador_cliente", AttributeType: "S" }, { AttributeName: "fecha", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
        GlobalSecondaryIndexes: [{ IndexName: ÍNDICE_CLIENTE, Projection: { ProjectionType: "ALL" },
          KeySchema: [{ AttributeName: "identificador_cliente", KeyType: "HASH" }, { AttributeName: "fecha", KeyType: "RANGE" }] }],
      })).catch(error => { if (error?.name !== "ResourceInUseException") throw error; });
      await waitUntilTableExists({ client: this.cliente, maxWaitTime: 30 }, { TableName: this.tabla });
    }
  }

  async clave(clave: string): Promise<RegistroClave | null> {
    const { Item } = await this.documentos.send(new GetCommand({ TableName: this.tabla, Key: { pk: `CLAVE#${clave}`, sk: "CLAVE" }, ConsistentRead: true }));
    return Item ? { clave, huella: Item.huella, resultado: Item.resultado } : null;
  }

  async movimientosDelPedido(pedido: string): Promise<MovimientosDelPedido> {
    const { Items = [] } = await this.documentos.send(new QueryCommand({ TableName: this.tabla, KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `PEDIDO#${pedido}` }, ConsistentRead: true }));
    const de = (tipo: string) => { const elemento = Items.find(item => item.sk === tipo); return elemento ? this.sinLlaves(elemento) : null; };
    return { acreditación: de("ACREDITACION"), reversa: de("REVERSA") };
  }

  acreditar(movimiento: Movimiento, clave: RegistroClave): Promise<boolean> {
    const pedido = movimiento.identificador_pedido;
    return this.transaccion([
      this.insertar({ pk: `PEDIDO#${pedido}`, sk: "ACREDITACION", ...movimiento }),
      this.comprobar({ pk: `PEDIDO#${pedido}`, sk: "REVERSA" }, "attribute_not_exists(pk)"),
      this.sumarSaldo(movimiento.identificador_cliente, movimiento.puntos),
      this.operaciónClave(clave),
    ]);
  }

  revertirAcreditado(reversa: Movimiento, clave: RegistroClave): Promise<boolean> {
    const pedido = reversa.identificador_pedido;
    return this.transaccion([
      this.comprobar({ pk: `PEDIDO#${pedido}`, sk: "ACREDITACION" }, "attribute_exists(pk)"),
      this.insertar({ pk: `PEDIDO#${pedido}`, sk: "REVERSA", ...reversa }),
      this.sumarSaldo(reversa.identificador_cliente, -reversa.puntos),
      this.operaciónClave(clave),
    ]);
  }

  marcarReversaSinAcreditacion(reversa: Movimiento, clave: RegistroClave): Promise<boolean> {
    const pedido = reversa.identificador_pedido;
    return this.transaccion([
      this.comprobar({ pk: `PEDIDO#${pedido}`, sk: "ACREDITACION" }, "attribute_not_exists(pk)"),
      this.insertar({ pk: `PEDIDO#${pedido}`, sk: "REVERSA", ...reversa }),
      this.operaciónClave(clave),
    ]);
  }

  async registrarClave(clave: RegistroClave): Promise<boolean> {
    try {
      await this.documentos.send(new PutCommand(this.operaciónClave(clave).Put!));
      return true;
    } catch (error) {
      if ((error as Error)?.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async saldoYMovimientos(cliente: string): Promise<{ saldo: number; movimientos: Movimiento[] }> {
    const { Item } = await this.documentos.send(new GetCommand({ TableName: this.tabla, Key: { pk: `CLIENTE#${cliente}`, sk: "SALDO" }, ConsistentRead: true }));
    const movimientos: Movimiento[] = [];
    let inicio: Record<string, any> | undefined;
    do {
      // Los índices secundarios son de consistencia eventual; el saldo sí se lee de forma consistente.
      const página = await this.documentos.send(new QueryCommand({ TableName: this.tabla, IndexName: ÍNDICE_CLIENTE,
        KeyConditionExpression: "identificador_cliente = :cliente", ExpressionAttributeValues: { ":cliente": cliente }, ExclusiveStartKey: inicio }));
      movimientos.push(...(página.Items ?? []).map(item => this.sinLlaves(item)));
      inicio = página.LastEvaluatedKey;
    } while (inicio);
    return { saldo: Item?.saldo ?? 0, movimientos };
  }

  async disponible(): Promise<boolean> {
    try {
      await this.cliente.send(new DescribeTableCommand({ TableName: this.tabla }));
      return true;
    } catch {
      return false;
    }
  }

  private async transaccion(operaciones: Operacion[]): Promise<boolean> {
    try {
      await this.documentos.send(new TransactWriteCommand({ TransactItems: operaciones }));
      return true;
    } catch (error) {
      // Condición incumplida o conflicto con otra transacción: la capa de negocio relee el estado y decide.
      if (error instanceof TransactionCanceledException) return false;
      throw error;
    }
  }

  private operaciónClave(clave: RegistroClave) {
    return this.insertar({ pk: `CLAVE#${clave.clave}`, sk: "CLAVE", huella: clave.huella, resultado: clave.resultado });
  }

  private insertar(elemento: Record<string, unknown>) {
    return { Put: { TableName: this.tabla, Item: elemento, ConditionExpression: "attribute_not_exists(pk)" } } satisfies Operacion;
  }

  private comprobar(llave: Record<string, string>, condición: string): Operacion {
    return { ConditionCheck: { TableName: this.tabla, Key: llave, ConditionExpression: condición } };
  }

  private sumarSaldo(cliente: string, puntos: number): Operacion {
    return { Update: { TableName: this.tabla, Key: { pk: `CLIENTE#${cliente}`, sk: "SALDO" },
      UpdateExpression: "ADD saldo :puntos", ExpressionAttributeValues: { ":puntos": puntos } } };
  }

  private sinLlaves({ pk: _pk, sk: _sk, ...movimiento }: Record<string, any>): Movimiento {
    return movimiento as Movimiento;
  }
}
