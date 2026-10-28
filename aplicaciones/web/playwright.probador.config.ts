import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

// Cámara simulada de Chrome: transmite en bucle la foto de prueba convertida a Y4M (requiere ffmpeg en el PATH).
export const videoCámara = "node_modules/.cache/clb-probador/persona.y4m";
if (!existsSync(videoCámara)) {
  mkdirSync("node_modules/.cache/clb-probador", { recursive: true });
  try {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", "../probador-virtual/pruebas/fixtures/persona.jpg", "-vf", "scale=480:-2", "-pix_fmt", "yuv420p", "-frames:v", "1", videoCámara]);
  } catch {
    /* sin ffmpeg se omite la prueba de cámara */
  }
}

// Prueba de punta a punta del probador contra el stack Docker (web + probador + pasarela + Inventario + IA):
// `docker compose up -d --wait` en infraestructura/bases-de-datos antes de ejecutar `npm run pruebas:probador`.
export default defineConfig({
  testDir: "./pruebas/probador-navegador",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  outputDir: "test-results-probador",
  expect: { timeout: 60_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:14200",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 1360, height: 1000 },
  },
});
