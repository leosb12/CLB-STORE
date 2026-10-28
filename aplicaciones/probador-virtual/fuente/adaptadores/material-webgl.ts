import type {Material} from '../dominio/material-camiseta';
import type {Pose} from '../dominio/pose';

const vertices=`attribute vec2 posicion;
varying vec2 uv;
void main(){gl_Position=vec4(posicion,0.,1.);uv=vec2((posicion.x+1.)*.5,(1.-posicion.y)*.5);}`;
const fragmento=`precision highp float;
varying vec2 uv;
uniform sampler2D foto;
uniform sampler2D campo;
uniform sampler2D atlas;
uniform vec2 dimensiones;
uniform vec4 hombros;
uniform vec4 encuadre;
uniform vec3 color;
uniform float lado;
vec3 lineal(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){
 vec4 base=texture2D(foto,uv);
 vec2 datos=texture2D(campo,uv).rg;
 vec2 p=uv*dimensiones-.5-hombros.xy;
 vec2 q=vec2(p.x*hombros.z+p.y*hombros.w,-p.x*hombros.w+p.y*hombros.z);
 vec2 t=(q-encuadre.xy)/encuadre.zw;
 float borde=clamp(min(min(t.x,1.-t.x),min(t.y,1.-t.y))/.04,0.,1.);
 vec4 detalle=texture2D(atlas,(clamp(t,0.,1.)*(lado-1.)+.5)/lado);
 vec3 tela=mix(color,detalle.rgb,borde*detalle.a);
 vec3 resultado=clamp(srgb(lineal(tela)*datos.g*2.),0.,1.);
 gl_FragColor=vec4(mix(base.rgb,resultado,datos.r),base.a);
}`;

/** Composición a resolución de cámara. La máscara reducida no reduce el estampado. */
export class MaterialWebGL {
  readonly lienzo=document.createElement('canvas');
  private gl:WebGLRenderingContext;
  private programa:WebGLProgram;
  private buffer:WebGLBuffer;
  private texturas:WebGLTexture[]=[];
  private cerrado=false;
  constructor(private readonly material:Material){
    const gl=this.lienzo.getContext('webgl',{alpha:false,antialias:false,premultipliedAlpha:false});
    if(!gl)throw new Error('Este navegador no dispone de composición WebGL. Usa una fotografía.');
    this.gl=gl;
    const crearShader=(tipo:number,fuente:string)=>{
      const s=gl.createShader(tipo)!;gl.shaderSource(s,fuente);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw new Error('No se pudo preparar el material en la GPU. Usa una fotografía.');}
      return s;
    };
    const v=crearShader(gl.VERTEX_SHADER,vertices),f=crearShader(gl.FRAGMENT_SHADER,fragmento);
    const programa=gl.createProgram()!;gl.attachShader(programa,v);gl.attachShader(programa,f);gl.linkProgram(programa);
    gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(programa,gl.LINK_STATUS)){gl.deleteProgram(programa);throw new Error('La GPU no pudo iniciar el material. Usa una fotografía.');}
    this.programa=programa;gl.useProgram(programa);
    const buffer=gl.createBuffer()!;this.buffer=buffer;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const posicion=gl.getAttribLocation(programa,'posicion');gl.enableVertexAttribArray(posicion);gl.vertexAttribPointer(posicion,2,gl.FLOAT,false,0,0);
    for(let i=0;i<3;i++){
      const t=gl.createTexture()!;this.texturas.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(programa,['foto','campo','atlas'][i]),i);
    }
    const pixels=new Uint8Array(material.lado*material.lado*4);
    for(let i=0;i<material.mascara.length;i++){
      for(let k=0;k<3;k++)pixels[i*4+k]=Math.round(material.rgb[i*3+k]*255);
      pixels[i*4+3]=Math.round(material.mascara[i]*255);
    }
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,material.lado,material.lado,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    gl.uniform1f(gl.getUniformLocation(programa,'lado'),material.lado);
    gl.uniform3fv(gl.getUniformLocation(programa,'color'),material.color);
  }
  pintar(fuente:HTMLCanvasElement,campo:Uint8Array,anchoCampo:number,altoCampo:number,pose:Pose):HTMLCanvasElement{
    const gl=this.gl;
    if(this.cerrado||gl.isContextLost())throw new Error('Se perdió la composición de vídeo. Reinicia la cámara o usa una fotografía.');
    const [a,b]=pose[5].x<pose[6].x?[pose[5],pose[6]]:[pose[6],pose[5]],dx=b.x-a.x,dy=b.y-a.y,distancia=Math.hypot(dx,dy),e=this.material.encuadre;
    if(distancia<1||campo.length!==anchoCampo*altoCampo*4)throw new Error('Muestra el torso completo para aplicar el tejido.');
    if(this.lienzo.width!==fuente.width||this.lienzo.height!==fuente.height){this.lienzo.width=fuente.width;this.lienzo.height=fuente.height;}
    gl.viewport(0,0,fuente.width,fuente.height);gl.useProgram(this.programa);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texturas[0]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,fuente);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.texturas[1]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,anchoCampo,altoCampo,0,gl.RGBA,gl.UNSIGNED_BYTE,campo);
    gl.uniform2f(gl.getUniformLocation(this.programa,'dimensiones'),fuente.width,fuente.height);
    gl.uniform4f(gl.getUniformLocation(this.programa,'hombros'),(a.x+b.x)/2,(a.y+b.y)/2,dx/(distancia*distancia),dy/(distancia*distancia));
    gl.uniform4f(gl.getUniformLocation(this.programa,'encuadre'),e.izquierda,e.arriba,e.ancho,e.alto);
    gl.drawArrays(gl.TRIANGLES,0,6);
    return this.lienzo;
  }
  cerrar():void{
    if(this.cerrado)return;this.cerrado=true;
    for(const t of this.texturas)this.gl.deleteTexture(t);
    this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.programa);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.lienzo.width=1;this.lienzo.height=1;
  }
}
