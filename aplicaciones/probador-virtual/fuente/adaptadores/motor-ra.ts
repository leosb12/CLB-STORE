import * as THREE from "three";
import type { Mascara } from "../dominio/ra/cuerpo";
import type { EscenaRA } from "../dominio/ra/malla-ra";
import { ALTO_TEXTURA, ANCHO_TEXTURA } from "../dominio/ra/malla-ra";

type Fuente = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

const VERTICE_PLANO = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Textura que cambia de fuente o de tamaño entre cuadros (video, foto, cuadro reducido). Una `Texture` común reserva
 * memoria inmutable (texStorage2D) y mide un <video> por su atributo `width`, que vale 0: el video nunca se subía.
 * `VideoTexture` sube con texImage2D usando el tamaño real de la fuente y sin mipmaps.
 */
const texturaDinamica = (fuente?: TexImageSource) => {
  const t = new THREE.VideoTexture(document.createElement("video"));
  if (fuente) t.image = fuente;
  return t;
};

/**
 * Composición de realidad aumentada en WebGL: video → prenda 3D con prueba de profundidad → cabeza, cuello y manos
 * reales encima (máscara de la persona). La prenda hereda el brillo del cuadro para no verse pegada.
 */
export class MotorRA {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camara = new THREE.OrthographicCamera(0, 1, 0, 1, -5000, 5000);
  private readonly escenaFondo = new THREE.Scene();
  private readonly escenaPrenda = new THREE.Scene();
  private readonly escenaEncima = new THREE.Scene();
  private readonly video = texturaDinamica();
  private mascara?: THREE.DataTexture;
  /** Una malla con su atlas por prenda del conjunto; comparten el sombreado de la escena. */
  private prendas: { malla: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; atlas: THREE.Texture }[] = [];
  private readonly materialEncima: THREE.ShaderMaterial;
  private readonly materialPrenda: THREE.ShaderMaterial;
  private readonly plano = new THREE.PlaneGeometry(2, 2);
  private readonly materialFondo: THREE.ShaderMaterial;

  constructor(readonly lienzo: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.video.colorSpace = THREE.SRGBColorSpace;
    const plano = this.plano;
    this.escenaFondo.add(new THREE.Mesh(plano, this.materialFondo = new THREE.ShaderMaterial({
      uniforms: { mapa: { value: this.video } }, vertexShader: VERTICE_PLANO, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D mapa; varying vec2 vUv; void main(){ gl_FragColor = texture2D(mapa, vUv);
#include <colorspace_fragment>
}`,
    })));
    this.materialPrenda = new THREE.ShaderMaterial({
      uniforms: { atlas: { value: null }, brillo: { value: 1 }, sombra: { value: null }, tam: { value: new THREE.Vector2(1, 1) }, luzMedia: { value: 0.5 } },
      side: THREE.DoubleSide, transparent: false,
      vertexShader: `attribute float luz; varying vec2 vUv; varying float vLuz; varying vec2 vPantalla; uniform vec2 tam;
        void main(){ vUv = uv; vLuz = luz; vPantalla = vec2(position.x / tam.x, 1.0 - position.y / tam.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // La luz de la escena (versión muy desenfocada del cuadro) modula la prenda: sombras y lado iluminado reales,
      // sin copiar el estampado de la ropa propia.
      fragmentShader: `uniform sampler2D atlas; uniform sampler2D sombra; uniform float brillo; uniform float luzMedia; varying vec2 vUv; varying float vLuz; varying vec2 vPantalla;
        void main(){ vec4 c = texture2D(atlas, vUv); if (c.a < 0.5) discard;
          float l = dot(texture2D(sombra, vPantalla).rgb, vec3(0.299, 0.587, 0.114));
          float escena = mix(1.0, clamp(l / max(0.05, luzMedia), 0.6, 1.3), 0.55);
          gl_FragColor = vec4(c.rgb * vLuz * brillo * escena, 1.0);
#include <colorspace_fragment>
}`,
    });
    this.materialEncima = new THREE.ShaderMaterial({
      uniforms: { mapa: { value: this.video }, mascara: { value: null }, cuello: { value: Array.from({ length: 9 }, () => new THREE.Vector2()) },
        manos: { value: [new THREE.Vector3(), new THREE.Vector3()] }, tam: { value: new THREE.Vector2(1, 1) }, piel: { value: new THREE.Vector2(0, 0) } },
      vertexShader: VERTICE_PLANO, depthTest: false, depthWrite: false, transparent: true,
      fragmentShader: `uniform sampler2D mapa; uniform sampler2D mascara; uniform vec2 cuello[9]; uniform vec3 manos[2]; uniform vec2 tam; uniform vec2 piel; varying vec2 vUv;
        vec2 croma(vec3 c){ return vec2(-0.1687*c.r - 0.3313*c.g + 0.5*c.b, 0.5*c.r - 0.4187*c.g - 0.0813*c.b); }
        float lineaCuello(float x){
          if (x <= cuello[0].x) return cuello[0].y;
          for (int i = 0; i < 8; i++) { if (x <= cuello[i+1].x) { float w = (x - cuello[i].x) / max(1.0, cuello[i+1].x - cuello[i].x); return mix(cuello[i].y, cuello[i+1].y, w); } }
          return cuello[8].y;
        }
        void main(){
          vec2 p = vec2(vUv.x, 1.0 - vUv.y) * tam;
          float persona = texture2D(mascara, vec2(vUv.x, 1.0 - vUv.y)).r;
          float cabeza = smoothstep(2.0, -2.0, p.y - lineaCuello(p.x));
          float mano = 0.0;
          for (int i = 0; i < 2; i++) if (manos[i].z > 0.0) mano = max(mano, smoothstep(manos[i].z, manos[i].z * 0.8, distance(p, manos[i].xy)));
          // En la mano solo pasa la piel (croma parecido al de la cara): el puño de la ropa propia queda tapado.
          mano *= smoothstep(0.085, 0.045, distance(croma(texture2D(mapa, vUv).rgb), piel));
          float a = smoothstep(0.35, 0.65, persona) * max(cabeza, mano);
          if (a < 0.01) discard;
          gl_FragColor = vec4(texture2D(mapa, vUv).rgb, a);
#include <colorspace_fragment>
        }`,
    });
    this.escenaEncima.add(new THREE.Mesh(plano, this.materialEncima));
  }

  /** Prendas del conjunto, en el orden de los modelos de la escena: frente y espalda (mismo tamaño) en un atlas 2:1. */
  ponerPrendas(lista: { frente: CanvasImageSource; espalda: CanvasImageSource }[]): void {
    this.quitarPrendas();
    this.prendas = lista.map(({ frente, espalda }) => {
      const c = document.createElement("canvas");
      c.width = ANCHO_TEXTURA * 2;
      c.height = ALTO_TEXTURA;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(frente, 0, 0, ANCHO_TEXTURA, ALTO_TEXTURA);
      ctx.drawImage(espalda, ANCHO_TEXTURA, 0, ANCHO_TEXTURA, ALTO_TEXTURA);
      const atlas = new THREE.CanvasTexture(c);
      atlas.colorSpace = THREE.SRGBColorSpace;
      atlas.anisotropy = 4;
      atlas.flipY = false; // v crece hacia abajo, como en la textura
      // Mismo programa de sombreado; uniformes propios para el atlas y compartidos para la luz de la escena.
      const material = this.materialPrenda.clone();
      material.uniforms = { ...this.materialPrenda.uniforms, atlas: { value: atlas } };
      const malla = new THREE.Mesh(new THREE.BufferGeometry(), material);
      malla.frustumCulled = false;
      this.escenaPrenda.add(malla);
      return { malla, atlas };
    });
  }

  private quitarPrendas(): void {
    for (const { malla, atlas } of this.prendas) {
      this.escenaPrenda.remove(malla);
      malla.geometry.dispose();
      malla.material.dispose();
      atlas.dispose();
    }
    this.prendas = [];
  }

  private readonly reducido = document.createElement("canvas");
  private readonly sombra = texturaDinamica(this.reducido);
  private readonly lienzoPiel = Object.assign(document.createElement("canvas"), { width: 4, height: 4 });

  /** Cuadro reducido a 32 px de ancho: luz de la escena, luz media del torso y croma de la piel de la cara. */
  private medirLuz(fuente: Fuente, ancho: number, alto: number, escena: EscenaRA): { media: number; piel: [number, number] } {
    const r = this.reducido, w = 32, h = Math.max(8, Math.round((32 * alto) / ancho));
    if (r.width !== w || r.height !== h) { r.width = w; r.height = h; }
    const ctx = r.getContext("2d", { willReadFrequently: true })!;
    ctx.filter = "blur(1.5px)";
    ctx.drawImage(fuente, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    this.sombra.needsUpdate = true;
    const xs = escena.cuello.map((p) => p.x), ys = escena.cuello.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = Math.min(...ys), a0 = Math.max(1, Math.max(...xs) - Math.min(...xs));
    let suma = 0, n = 0;
    for (let y = Math.floor(((cy + a0) / alto) * h); y < Math.min(h, ((cy + a0 * 4) / alto) * h); y++)
      for (let x = Math.floor(((cx - a0) / ancho) * w); x < ((cx + a0) / ancho) * w; x++) {
        if (x < 0 || x >= w || y < 0) continue;
        const i = (y * w + x) * 4;
        suma += (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255; n++;
      }
    // Piel: parche de la cara, por encima del cuello de la prenda.
    const c = this.lienzoPiel.getContext("2d", { willReadFrequently: true })!;
    c.drawImage(fuente, cx - 6, Math.max(0, cy - a0 * 0.9) - 6, 12, 12, 0, 0, 4, 4);
    const pd = c.getImageData(0, 0, 4, 4).data;
    let cb = 0, cr = 0;
    for (let i = 0; i < pd.length; i += 4) {
      const rr = pd[i]! / 255, gg = pd[i + 1]! / 255, bb = pd[i + 2]! / 255;
      cb += -0.1687 * rr - 0.3313 * gg + 0.5 * bb; cr += 0.5 * rr - 0.4187 * gg - 0.0813 * bb;
    }
    return { media: n ? suma / n : 0.5, piel: [cb / 16, cr / 16] };
  }

  /** La malla cambia cada cuadro pero casi nunca de tamaño: se reescriben los mismos buffers en la GPU. */
  private ponerGeometria(g: THREE.BufferGeometry, piezas: EscenaRA["piezas"]): void {
    const pos: number[] = [], uv: number[] = [], luz: number[] = [], idx: number[] = [];
    for (const p of piezas) {
      const base = pos.length / 3;
      // z invertida: la cámara ortográfica mira hacia -z y lo más cercano tiene z mayor.
      for (let k = 0; k < p.posiciones.length; k += 3) pos.push(p.posiciones[k]!, p.posiciones[k + 1]!, p.posiciones[k + 2]!);
      uv.push(...p.uv); luz.push(...p.luz);
      for (const i of p.indices) idx.push(base + i);
    }
    const poner = (nombre: string, datos: number[], n: number) => {
      const a = g.getAttribute(nombre) as THREE.BufferAttribute | undefined;
      if (a && a.array.length === datos.length) { (a.array as Float32Array).set(datos); a.needsUpdate = true; }
      else { if (a) g.dispose(); g.setAttribute(nombre, new THREE.Float32BufferAttribute(datos, n)); }
    };
    poner("position", pos, 3); poner("uv", uv, 2); poner("luz", luz, 1);
    const indice = g.getIndex();
    if (indice && indice.array.length === idx.length) { (indice.array as Uint16Array | Uint32Array).set(idx); indice.needsUpdate = true; }
    else g.setIndex(idx);
  }

  dibujar(fuente: Fuente, ancho: number, alto: number, mascara?: Mascara | null, escena?: EscenaRA | null, brillo = 1): void {
    if (this.lienzo.width !== ancho || this.lienzo.height !== alto) this.renderer.setSize(ancho, alto, false);
    this.camara.left = 0; this.camara.right = ancho; this.camara.top = 0; this.camara.bottom = alto;
    this.camara.position.set(0, 0, 0); this.camara.updateProjectionMatrix();
    this.video.image = fuente;
    this.video.needsUpdate = true;
    this.renderer.clear();
    this.renderer.render(this.escenaFondo, this.camara);
    if (escena && this.prendas.length && mascara) {
      if (!this.mascara || this.mascara.image.width !== mascara.ancho || this.mascara.image.height !== mascara.alto) {
        this.mascara?.dispose();
        this.mascara = new THREE.DataTexture(mascara.datos, mascara.ancho, mascara.alto, THREE.RedFormat, THREE.UnsignedByteType);
        this.mascara.minFilter = this.mascara.magFilter = THREE.LinearFilter;
        this.materialEncima.uniforms.mascara!.value = this.mascara;
      } else {
        this.mascara.image.data = mascara.datos;
      }
      this.mascara.needsUpdate = true;
      this.prendas.forEach(({ malla }, k) => this.ponerGeometria(malla.geometry, escena.piezas.filter((p) => p.prenda === k)));
      this.materialPrenda.uniforms.brillo!.value = brillo;
      const ambiente = this.medirLuz(fuente, ancho, alto, escena);
      this.materialPrenda.uniforms.sombra!.value = this.sombra;
      this.materialPrenda.uniforms.luzMedia!.value = ambiente.media;
      (this.materialPrenda.uniforms.tam!.value as THREE.Vector2).set(ancho, alto);
      (this.materialEncima.uniforms.piel!.value as THREE.Vector2).set(ambiente.piel[0], ambiente.piel[1]);
      this.renderer.clearDepth();
      this.renderer.render(this.escenaPrenda, this.camara);
      const u = this.materialEncima.uniforms;
      const cuello = [...escena.cuello].sort((a, b) => a.x - b.x);
      (u.cuello!.value as THREE.Vector2[]).forEach((v, k) => v.set(cuello[k]?.x ?? -1, cuello[k]?.y ?? -1));
      (u.manos!.value as THREE.Vector3[]).forEach((v, k) => { const m = escena.manos[k]; v.set(m?.x ?? 0, m?.y ?? 0, m?.r ?? 0); });
      (u.tam!.value as THREE.Vector2).set(ancho, alto);
      this.renderer.render(this.escenaEncima, this.camara);
    }
  }

  destruir(): void {
    this.quitarPrendas();
    this.materialPrenda.dispose();
    this.materialEncima.dispose();
    this.materialFondo.dispose();
    this.plano.dispose();
    this.mascara?.dispose();
    this.video.dispose();
    this.sombra.dispose();
    this.renderer.dispose();
    // Sin esto el contexto vive hasta la recolección de basura; Chrome admite ~16 y descartaría el de TF.js.
    this.renderer.forceContextLoss();
  }
}
