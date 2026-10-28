// Banco de rendimiento de BlazePose en el dispositivo (no se publica): mediana y p95 por variante y tamaño.
import { DetectorBlazePose } from "../fuente/adaptadores/detector-blazepose";

const foto = new Image();
foto.src = "../pruebas/fixtures/persona.jpg";
await foto.decode();
const reducida = document.createElement("canvas");
reducida.width = 480; reducida.height = Math.round(480 * foto.naturalHeight / foto.naturalWidth);
reducida.getContext("2d")!.drawImage(foto, 0, 0, reducida.width, reducida.height);
const salida = document.getElementById("r")!;
const resultado: Record<string, unknown> = { agente: navigator.userAgent };
const casos = [
  ["full_960", "full", foto, foto.naturalWidth, foto.naturalHeight],
  ["lite_960", "lite", foto, foto.naturalWidth, foto.naturalHeight],
] as const;
for (const [nombre, variante, fuente, ancho, alto] of casos) {
  const detector = new DetectorBlazePose("/modelos/blazepose-3d/", variante);
  await detector.estimar(fuente, ancho, alto, 0);
  const tiempos: number[] = [];
  for (let i = 1; i <= 30; i++) {
    const t = performance.now();
    await detector.estimar(fuente, ancho, alto, i * 50);
    tiempos.push(performance.now() - t);
  }
  detector.destruir();
  tiempos.sort((a, b) => a - b);
  resultado[nombre] = { mediana_ms: Math.round(tiempos[15]!), p95_ms: Math.round(tiempos[28]!), img_s: Math.round(10000 / tiempos[15]!) / 10 };
  salida.textContent = JSON.stringify(resultado, null, 1);
}
(window as unknown as Record<string, unknown>).resultado = resultado;
