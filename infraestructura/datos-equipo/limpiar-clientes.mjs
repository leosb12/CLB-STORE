import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
if (process.env.CLB_ENTORNO !== 'local' || process.env.CLB_DYNAMODB_ENDPOINT !== 'http://dynamodb:8000') throw new Error('Solo DynamoDB Local');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({endpoint: process.env.CLB_DYNAMODB_ENDPOINT,
  region: process.env.CLB_DYNAMODB_REGION, credentials: {accessKeyId: process.env.CLB_DYNAMODB_IDENTIFICADOR, secretAccessKey: process.env.CLB_DYNAMODB_CLAVE}}));
let cursor, borrados = 0, perfiles = 0;
do {
  const pagina = await db.send(new ScanCommand({TableName:'clb_fidelizacion', ConsistentRead:true, ExclusiveStartKey:cursor}));
  for (const item of pagina.Items ?? []) {
    if (item.pk.startsWith('PERFIL#')) { perfiles++; continue; }
    if (!/^(PEDIDO|CLIENTE|CLAVE)#/.test(item.pk)) throw new Error('Registro desconocido; no se elimina');
    if (process.argv.includes('--aplicar')) { await db.send(new DeleteCommand({TableName:'clb_fidelizacion', Key:{pk:item.pk,sk:item.sk}})); }
    borrados++;
  }
  cursor = pagina.LastEvaluatedKey;
} while (cursor);
console.log(JSON.stringify({operaciones:borrados,perfiles_conservados:perfiles,aplicado:process.argv.includes('--aplicar')}));
