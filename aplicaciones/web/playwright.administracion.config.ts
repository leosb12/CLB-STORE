import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";

const colección = "clb_prueba_web_" + randomUUID().replaceAll("-", "");
export default defineConfig({
  testDir: "./pruebas/administracion-navegador",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  outputDir: "test-results-administracion",
  expect: { timeout: 20_000 },
  reporter: "list",
  metadata: { colección },
  globalTeardown: "./pruebas/soporte/finalizar-administracion.ts",
  use: {
    baseURL: "http://127.0.0.1:14201",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "powershell.exe -NoProfile -File ../../microservicios/inventario/ejecutar-php.ps1 artisan serve --host=127.0.0.1 --port=18081 --no-reload",
      url: "http://127.0.0.1:18081/api/v1/productos",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        CLB_MONGO_COLECCION: colección,
        CLB_ADMINISTRACION_LOCAL_HABILITADA: "true",
        APP_ENV: "local",
      },
    },
    {
      command: "npm run previsualizar",
      url: "http://127.0.0.1:14201",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        CLB_WEB_PUERTO: "14201",
        CLB_INVENTARIO_URL: "http://127.0.0.1:18081",
      },
    },
  ],
});
