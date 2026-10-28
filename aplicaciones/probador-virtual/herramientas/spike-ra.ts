// Banco de desarrollo de la RA: foto + prendas del catálogo (modelo 3D generado por el worker). No se publica.
import { DetectorBlazePose } from "../fuente/adaptadores/detector-blazepose";
import { MotorRA } from "../fuente/adaptadores/motor-ra";
import { medirCuerpo } from "../fuente/dominio/ra/cuerpo";
import { construirEscena } from "../fuente/dominio/ra/malla-ra";
import { validarModelo3D } from "../fuente/dominio/ra/modelo-prenda";

const q = new URLSearchParams(location.search);
const cargar = async (src: string) => { const i = new Image(); i.src = src; await i.decode(); return i; };
const foto = await cargar(q.get("foto") ?? "../pruebas/fixtures/persona.jpg");
const prendas = (q.get("prenda") ?? "chaqueta-azul").split(",");
const detector = new DetectorBlazePose("/modelos/blazepose-3d/");
const t0 = performance.now();
const obs = await detector.estimar(foto, foto.naturalWidth, foto.naturalHeight);
const tDetectar = performance.now() - t0;
const lienzo = document.getElementById("c") as HTMLCanvasElement;
const motor = new MotorRA(lienzo);
const cuerpo = obs && medirCuerpo(obs.puntos, obs.mascara);
const giro = q.get("giro");
if (cuerpo && giro) cuerpo.giro = Number(giro);
let escena = null;
for (const nombre of prendas) {
  const modelo = validarModelo3D(await (await fetch(`../temporales/ra/${nombre}.modelo.json`)).json());
  const [frente, espalda] = await Promise.all([cargar(`../temporales/ra/${nombre}.png`), cargar(`../temporales/ra/${nombre}.espalda.png`)]);
  motor.ponerPrenda(frente, espalda);
  escena = modelo && cuerpo ? construirEscena(modelo, cuerpo, obs!.puntos) : null;
  motor.dibujar(foto, foto.naturalWidth, foto.naturalHeight, obs!.mascara, escena);
}
let suma = 0;
for (const v of obs?.mascara.datos ?? []) suma += v > 127 ? 1 : 0;
(window as unknown as Record<string, unknown>).resultado = {
  tDetectar: Math.round(tDetectar), cuerpo: !!cuerpo, giro: cuerpo?.giro, anchoHombros: cuerpo?.anchoHombros, anchoReal: cuerpo?.anchoReal,
  fraccionPersona: suma / ((obs?.mascara.datos.length) || 1), piezas: escena?.piezas.map((p) => p.indices.length / 3),
};

// Depuración: puntos, huesos con su radio y anchos del torso medidos en la máscara.
if (q.get("depurar") && obs && cuerpo) {
  const d = document.createElement("canvas");
  d.width = foto.naturalWidth; d.height = foto.naturalHeight;
  const g = d.getContext("2d")!;
  g.drawImage(foto, 0, 0);
  const img = g.getImageData(0, 0, d.width, d.height);
  for (let i = 0; i < obs.mascara.datos.length; i++) if (obs.mascara.datos[i]! > 127) img.data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1]! + 60);
  g.putImageData(img, 0, 0);
  g.lineWidth = 2;
  for (const f of cuerpo.torso) {
    g.strokeStyle = "#f0f";
    g.beginPath(); g.moveTo(f.centro.x - cuerpo.derecha.x * f.semiancho, f.centro.y - cuerpo.derecha.y * f.semiancho); g.lineTo(f.centro.x + cuerpo.derecha.x * f.semiancho, f.centro.y + cuerpo.derecha.y * f.semiancho); g.stroke();
  }
  for (const s of [...cuerpo.brazos, ...(cuerpo.piernas ?? [])]) {
    g.strokeStyle = "#0ff"; g.beginPath(); s.puntos.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
    s.puntos.forEach((p, k) => { g.strokeStyle = "#ff0"; g.beginPath(); g.arc(p.x, p.y, s.radios[k]!, 0, 7); g.stroke(); });
  }
  obs.puntos.forEach((p, i) => { g.fillStyle = p.c > 0.5 ? "#0f0" : "#f00"; g.fillRect(p.x - 3, p.y - 3, 6, 6); g.fillStyle = "#fff"; g.fillText(String(i), p.x + 4, p.y); });
  (window as unknown as Record<string, unknown>).depuracion = d.toDataURL("image/png");
  (window as unknown as Record<string, unknown>).z = obs.puntos.map((p) => Math.round(p.z));
}
