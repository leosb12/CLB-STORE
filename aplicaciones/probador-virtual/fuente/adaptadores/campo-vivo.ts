import type {Pose} from '../dominio/pose';
import {FotogramaNoApto} from '../aplicacion/casos-de-uso';

/** Una tarea por worker. Terminarlo invalida también la promesa pendiente. */
export class CampoVivo {
  private worker=new Worker(new URL('./campo-vivo.worker.ts',import.meta.url),{type:'module'});
  private pendiente?:{resolver:(v:Uint8Array)=>void;rechazar:(e:Error)=>void};
  private cerrado=false;
  constructor(){
    this.worker.onmessage=({data}:{data:{pixeles?:Uint8Array;error?:string}})=>{
      const p=this.pendiente;this.pendiente=undefined;
      if(data.error)p?.rechazar(new FotogramaNoApto(data.error));
      else if(data.pixeles)p?.resolver(data.pixeles);
      else p?.rechazar(new Error('Respuesta de máscara inválida.'));
    };
    this.worker.onerror=()=>{this.pendiente?.rechazar(new Error('No se pudo iniciar el análisis local de vídeo.'));this.pendiente=undefined;};
  }
  calcular(ancho:number,alto:number,rgba:Uint8ClampedArray,probabilidades:Float32Array,pose:Pose):Promise<Uint8Array>{
    if(this.cerrado||this.pendiente)return Promise.reject(new Error('El análisis de vídeo no está disponible.'));
    return new Promise((resolver,rechazar)=>{
      this.pendiente={resolver,rechazar};
      this.worker.postMessage({ancho,alto,rgba,probabilidades,pose},[rgba.buffer,probabilidades.buffer]);
    });
  }
  cerrar():void{
    this.cerrado=true;this.worker.terminate();
    this.pendiente?.rechazar(new Error('La cámara se cerró.'));this.pendiente=undefined;
  }
}
