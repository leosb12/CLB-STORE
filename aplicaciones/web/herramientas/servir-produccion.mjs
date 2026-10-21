import { createServer, request } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const raíz = fileURLToPath(
  new URL("../dist/clb-store/browser/", import.meta.url),
);
const puerto = Number(process.env["CLB_WEB_PUERTO"] ?? 14200);
const inventario = new URL(
  process.env["CLB_INVENTARIO_URL"] ?? "http://127.0.0.1:18080",
);
const tipos = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
createServer(async (solicitud, respuesta) => {
  const ruta = new URL(solicitud.url, "http://localhost").pathname;
  if (ruta.startsWith("/api/")) {
    const destino = new URL(solicitud.url, inventario);
    const petición = request(
      destino,
      {
        method: solicitud.method,
        headers: { ...solicitud.headers, host: inventario.host },
        timeout: 12_000,
      },
      (remota) => {
        respuesta.writeHead(remota.statusCode, {
          ...remota.headers,
          "Cache-Control": "no-store",
        });
        remota.pipe(respuesta);
      },
    );
    petición.on("timeout", () => petición.destroy());
    petición.on("error", () => {
      if (!respuesta.headersSent)
        respuesta.writeHead(503, { "Content-Type": "application/json" });
      respuesta.end(
        JSON.stringify({ mensaje: "Inventario no está disponible." }),
      );
    });
    solicitud.pipe(petición);
    return;
  }
  try {
    let archivo = resolve(raíz, "." + decodeURIComponent(ruta));
    if (archivo !== resolve(raíz) && !archivo.startsWith(resolve(raíz) + sep)) {
      respuesta.writeHead(403);
      respuesta.end();
      return;
    }
    try {
      if (!(await stat(archivo)).isFile())
        archivo = resolve(raíz, "index.html");
    } catch {
      if (extname(ruta)) {
        respuesta.writeHead(404);
        respuesta.end();
        return;
      }
      archivo = resolve(raíz, "index.html");
    }
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, {
      "Content-Type": tipos[extname(archivo)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    respuesta.end(contenido);
  } catch {
    respuesta.writeHead(500);
    respuesta.end("No se pudo servir CLB Store. Ejecuta npm run build.");
  }
}).listen(puerto, "127.0.0.1", () =>
  process.stdout.write(`CLB Store: http://127.0.0.1:${puerto}\n`),
);
