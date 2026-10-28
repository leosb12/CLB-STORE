/**
 * Suavizado temporal del cuerpo medido. BlazePose ya suaviza sus puntos; aquí se suavizan las medidas derivadas
 * (giro, anchos del torso, radios de brazos y piernas), que saltaban de un cuadro a otro y hacían temblar la prenda.
 * Filtro One Euro (Casiez et al., 2012): casi sin retraso al moverse rápido, muy estable al quedarse quieto.
 */
import type { Cuerpo } from "./cuerpo";

export class FiltroUnEuro {
  private x?: number;
  private dx = 0;
  private t?: number;

  /** `minimo`: corte en Hz en reposo (menor = más estable); `beta`: cuánto sube el corte con la velocidad. */
  constructor(private readonly minimo = 1.2, private readonly beta = 0.02, private readonly corteDerivada = 1) {}

  private static alfa(corte: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * corte);
    return 1 / (1 + tau / dt);
  }

  /** `t` en milisegundos. */
  filtrar(valor: number, t: number): number {
    if (this.x === undefined || this.t === undefined || t <= this.t) {
      this.x = valor;
      this.t = t;
      return valor;
    }
    const dt = (t - this.t) / 1000;
    this.t = t;
    const a = FiltroUnEuro.alfa(this.corteDerivada, dt);
    this.dx += a * ((valor - this.x) / dt - this.dx);
    this.x += FiltroUnEuro.alfa(this.minimo + this.beta * Math.abs(this.dx), dt) * (valor - this.x);
    return this.x;
  }
}

/** Retención por defecto: un cuadro sin cuerpo no hace desaparecer la prenda. */
export const RETENCION_MS = 300;

/** Por segundo: la referencia se olvida despacio, para no arrastrar un error de una pose rara. */
const OLVIDO_REFERENCIA = 0.93;

export class SuavizadorCuerpo {
  private readonly filtros = new Map<string, FiltroUnEuro>();
  private ultimo?: { cuerpo: Cuerpo; t: number };
  /** Mayor proporción hombros/torso reciente (de frente): `medirCuerpo` la usa para estimar el giro. */
  referencia = 0;

  constructor(private readonly retencion = RETENCION_MS) {}

  private f(clave: string, valor: number, t: number): number {
    let filtro = this.filtros.get(clave);
    if (!filtro) this.filtros.set(clave, (filtro = new FiltroUnEuro()));
    return filtro.filtrar(valor, t);
  }

  reiniciar(): void {
    this.filtros.clear();
    this.ultimo = undefined;
    this.referencia = 0;
  }

  /** Devuelve el cuerpo suavizado; sin cuerpo, el último durante `retencion` ms y después null. */
  filtrar(cuerpo: Cuerpo | null, t: number): Cuerpo | null {
    if (!cuerpo) {
      if (this.ultimo && t - this.ultimo.t <= this.retencion) return this.ultimo.cuerpo;
      this.reiniciar();
      return null;
    }
    const dt = this.ultimo ? Math.max(0, t - this.ultimo.t) / 1000 : 0;
    const c = cuerpo.caderas, h = cuerpo.hombros;
    const proporcion = c ? cuerpo.anchoHombros / Math.max(1, Math.hypot(c.x - h.x, c.y - h.y)) : 0;
    this.referencia = Math.max(proporcion, this.referencia * OLVIDO_REFERENCIA ** dt);
    // El giro es un ángulo: se suaviza su seno y coseno para no saltar entre π y −π.
    const giro = Math.atan2(this.f("giro.sen", Math.sin(cuerpo.giro), t), this.f("giro.cos", Math.cos(cuerpo.giro), t));
    const radios = (prefijo: string, r: number[]) => r.map((v, k) => this.f(`${prefijo}.${k}`, v, t));
    const suave: Cuerpo = {
      ...cuerpo,
      giro,
      anchoReal: this.f("anchoReal", cuerpo.anchoReal, t),
      torso: cuerpo.torso.map((fila, k) => ({ ...fila, semiancho: this.f(`torso.${k}`, fila.semiancho, t) })),
      brazos: [
        { ...cuerpo.brazos[0], radios: radios("brazo0", cuerpo.brazos[0].radios) },
        { ...cuerpo.brazos[1], radios: radios("brazo1", cuerpo.brazos[1].radios) },
      ],
      piernas: cuerpo.piernas && [
        { ...cuerpo.piernas[0], radios: radios("pierna0", cuerpo.piernas[0].radios) },
        { ...cuerpo.piernas[1], radios: radios("pierna1", cuerpo.piernas[1].radios) },
      ],
    };
    this.ultimo = { cuerpo: suave, t };
    return suave;
  }
}
