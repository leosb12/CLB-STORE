// Configuración por entorno: desarrollo local y cloud se separan aquí, nunca en el código de negocio.
const entorno = process.env.CLB_ENTORNO ?? "local";
const local = entorno === "local" || entorno === "pruebas";

export const configuracion = {
  puerto: Number(process.env.CLB_CLIENTES_PUERTO_INTERNO ?? 3000),
  host: process.env.CLB_CLIENTES_HOST ?? "0.0.0.0",
  origenes: (process.env.CLB_CORS_ORIGENES ?? "").split(",").map(v => v.trim()).filter(Boolean),
  entorno,
  tabla: process.env.CLB_CLIENTES_TABLA ?? "clb_fidelizacion",
  archivos: { bucket: process.env.CLB_S3_BUCKET, tabla: process.env.CLB_ARCHIVOS_TABLA ?? "clb_archivos" },
  dynamodb: {
    // Fuera de local no hay valores por defecto: se usan el endpoint real y la cadena de credenciales de AWS (rol IAM).
    endpoint: process.env.CLB_DYNAMODB_ENDPOINT ?? (local ? "http://127.0.0.1:8000" : undefined),
    region: process.env.CLB_DYNAMODB_REGION ?? "us-east-1",
    // Credenciales ficticias válidas solo para DynamoDB Local; nunca se usan en cloud.
    identificador: process.env.CLB_DYNAMODB_IDENTIFICADOR ?? (local ? "clblocal" : undefined),
    clave: process.env.CLB_DYNAMODB_CLAVE ?? (local ? "clblocalficticia" : undefined),
  },
  notificaciones: {
    // Envíos reales a FCM/Resend solo si se habilitan explícitamente; si no, cada canal queda como NO_CONFIGURADO.
    habilitadas: process.env.CLB_NOTIFICACIONES_HABILITADAS === "true",
    // El correo además exige su propio interruptor: solo se activa con destinatarios confirmados (buzón real verificado).
    correoHabilitado: process.env.CLB_NOTIFICACIONES_CORREO_HABILITADO === "true",
    correo: process.env.CLB_RESEND_API_KEY,
    remitente: process.env.CLB_SMTP_REMITENTE,
  },
  identidad: {
    // Emisor público estable (por la pasarela) y JWKS por la red interna de Compose.
    emisor: process.env.CLB_IDENTIDAD_EMISOR ?? "http://127.0.0.1:18000/identidad/realms/clb",
    jwks: process.env.CLB_IDENTIDAD_JWKS ?? "http://127.0.0.1:18000/identidad/realms/clb/protocol/openid-connect/certs",
  },
};
