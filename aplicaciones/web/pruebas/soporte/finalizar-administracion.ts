import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { FullConfig } from "@playwright/test";

export default async function finalizar(
  configuración: FullConfig,
): Promise<void> {
  const colección = configuración.metadata["colección"];
  if (
    typeof colección !== "string" ||
    !/^clb_prueba_web_[a-f0-9]{32}$/.test(colección)
  )
    throw new Error("Colección temporal no válida.");
  const raíz = resolve("../../microservicios/inventario");
  const resultado = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      resolve(raíz, "ejecutar-php.ps1"),
      "pruebas/Soporte/limpiar-coleccion-http.php",
      colección,
    ],
    { encoding: "utf8", cwd: raíz },
  );
  if (resultado.status !== 0)
    throw new Error(
      "No se pudo limpiar la colección temporal: " + resultado.stderr,
    );
  process.stdout.write(resultado.stdout);
}
