/** Referencia común para comprobar que los ports Dart/TS producen la misma malla. */
import {readFileSync,writeFileSync} from "node:fs";
import {analizarTextura,articularPrenda} from "../../aplicaciones/probador-virtual/fuente/dominio/prenda-articulada";
import {calcularAjuste,type Pose} from "../../aplicaciones/probador-virtual/fuente/dominio/pose";
const ruta=new URL("fixtures/regiones-articuladas.json",import.meta.url),f=JSON.parse(readFileSync(ruta,"utf8"));
const alfa=new Uint8Array(f.ancho*f.alto);
for(const [i,y,d,b] of f.rectangulos)for(let yy=y;yy<b;yy++)for(let x=i;x<d;x++)alfa[yy*f.ancho+x]=255;
const [i,y,d,b]=f.hueco;for(let yy=y;yy<b;yy++)for(let x=i;x<d;x++)alfa[yy*f.ancho+x]=0;
const pose:Pose=Array.from({length:17},()=>({x:0,y:0,confianza:0}));
for(const [i,p] of Object.entries(f.puntos) as [string,number[]][])pose[+i]={x:p[0]!,y:p[1]!,confianza:p[2]!};
const g=analizarTextura(alfa,f.ancho,f.alto,f.anclas)!,a=calcularAjuste(pose,"superior",f.ancho,f.alto,f.anclas);
if(!a.ajustado)throw new Error("Pose de referencia inválida");
writeFileSync(new URL("fixtures/regiones-resultado.json",import.meta.url),JSON.stringify(articularPrenda(g,pose,a.transformación),null,2)+"\n");
writeFileSync(new URL("../../aplicaciones/android/integration_test/regiones_fixture.dart",import.meta.url),
  "// Generado desde compartido/prendas/fixtures/regiones-articuladas.json; sin fotos personales.\n"+
  "const regionesFixtureJson = r'''"+JSON.stringify(f,null,2)+"''';\n");
