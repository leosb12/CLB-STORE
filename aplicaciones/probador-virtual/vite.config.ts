import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Escribe `manifiesto.json` con todos los archivos publicados: `precargar()` los pide para que la PWA los guarde. */
function manifiesto(): Plugin {
  let salida = "";
  return {
    name: "clb-manifiesto-probador",
    apply: "build",
    configResolved: (config) => void (salida = config.build.outDir),
    async closeBundle() {
      const archivos = (await readdir(salida, { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile() && e.name !== "manifiesto.json")
        .map((e) => relative(salida, join(e.parentPath, e.name)).split(sep).join("/"))
        .sort();
      await writeFile(join(salida, "manifiesto.json"), JSON.stringify({ version: new Date().toISOString(), archivos }, null, 1));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), manifiesto()],
  resolve: { alias: { "@mediapipe/pose": fileURLToPath(new URL("./fuente/adaptadores/sin-mediapipe.ts", import.meta.url)) } },
  // En modo biblioteca Vite no reemplaza process.env: React lo necesita para su versión de producción.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: { entry: "fuente/adaptadores/elemento-probador.tsx", formats: ["es"], fileName: () => "probador.js" },
    target: "es2022",
    chunkSizeWarningLimit: 2500,
  },
  server: {
    // Desarrollo independiente: el modelo de tallas sale de la pasarela local.
    proxy: { "/api": "http://127.0.0.1:18000", "/ilustraciones": "http://127.0.0.1:14200", "/prendas": "http://127.0.0.1:14200" },
  },
});
