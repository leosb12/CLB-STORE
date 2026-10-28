import {prepararCampoCamiseta} from '../dominio/campo-camiseta';
import {validarTransferencia} from '../dominio/material-camiseta';
import type {Pose} from '../dominio/pose';

// Solo datos numéricos del fotograma; sin red, DOM, almacenamiento o credenciales.
self.onmessage=(evento:MessageEvent<{ancho:number;alto:number;rgba:Uint8ClampedArray;probabilidades:Float32Array;pose:Pose}>)=>{
  try {
    const {ancho,alto,rgba,probabilidades,pose}=evento.data;
    validarTransferencia({ancho,alto,rgba},probabilidades,pose);
    const campo=prepararCampoCamiseta({ancho,alto,rgba},probabilidades,pose);
    const pixeles=new Uint8Array(ancho*alto*4);
    for(let i=0;i<ancho*alto;i++){
      pixeles[i*4]=Math.round(campo.alfa[i]*255);
      pixeles[i*4+1]=Math.round(campo.sombra[i]*127.5);
      pixeles[i*4+3]=255;
    }
    self.postMessage({pixeles}, {transfer:[pixeles.buffer]});
  }catch(e){self.postMessage({error:e instanceof Error?e.message:'No se pudo delimitar la camiseta.'});}
};
