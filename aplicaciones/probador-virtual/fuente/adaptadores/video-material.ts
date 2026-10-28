import type {CompositorVideo} from '../aplicacion/casos-de-uso';
import type {Material} from '../dominio/material-camiseta';
import type {Pose} from '../dominio/pose';
import {CampoVivo} from './campo-vivo';
import {MaterialWebGL} from './material-webgl';

/** Campo en Worker; composición GPU sobre el MISMO fotograma a resolución completa. */
export class VideoMaterialLocal implements CompositorVideo {
  private campo:CampoVivo;
  private renderer:MaterialWebGL;
  constructor(material:Material){
    this.renderer=new MaterialWebGL(material);
    try{this.campo=new CampoVivo();}catch(e){this.renderer.cerrar();throw e;}
  }
  async componer(fuente:HTMLCanvasElement,analisis:HTMLCanvasElement,probabilidades:Float32Array,pose:Pose):Promise<HTMLCanvasElement>{
    const ctx=analisis.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('No se pudo leer el fotograma de cámara.');
    const rgba=ctx.getImageData(0,0,analisis.width,analisis.height).data;
    const campo=await this.campo.calcular(analisis.width,analisis.height,rgba,probabilidades,pose);
    const poseCompleta=pose.map(p=>({...p,x:p.x*fuente.width/analisis.width,y:p.y*fuente.height/analisis.height}));
    return this.renderer.pintar(fuente,campo,analisis.width,analisis.height,poseCompleta);
  }
  cerrar():void{this.campo.cerrar();this.renderer.cerrar();}
}
