import { validarRecurso, type RecursoProbador, type TexturaGuardada } from "../dominio/recurso-probador";

/** Tamaño acotado incluso si el servidor no declara Content-Length. */
export async function descargarTextura(r: RecursoProbador, solicitar: typeof fetch, base: string): Promise<TexturaGuardada> {
  validarRecurso(r);
  const respuesta = await solicitar(`${base}/recursos-probador/${r.sha256}.png`, {cache: "no-store", signal: AbortSignal.timeout(20_000)});
  if (!respuesta.ok || respuesta.headers.get("Content-Type")?.split(";")[0] !== "image/png" || !respuesta.body)
    throw new Error("No se pudo descargar la textura publicada.");
  const lector = respuesta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {value,done} = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > r.bytes) throw new Error("La textura supera su tamaño declarado.");
      partes.push(value);
    }
  } catch (error) { await lector.cancel().catch(() => undefined); throw error; }
  finally { lector.releaseLock(); }
  const datos = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) { datos.set(parte,posicion); posicion += parte.byteLength; }
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",datos))].map(b => b.toString(16).padStart(2,"0")).join("");
  if (total !== r.bytes || hash !== r.sha256 || datos[0] !== 137 || datos[1] !== 80 || datos[2] !== 78 || datos[3] !== 71
    || new DataView(datos.buffer).getUint32(16) !== r.ancho || new DataView(datos.buffer).getUint32(20) !== r.alto || datos[25] !== 6)
    throw new Error("La textura está corrupta o no coincide con su manifiesto.");
  return {sha256: hash,blob: new Blob([datos],{type: "image/png"})};
}
