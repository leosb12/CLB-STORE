export const limitar=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const mediana=(a:number[])=>{a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]??0;};
export const luz=(r:number,g:number,b:number)=>.2126*r+.7152*g+.0722*b;

/** Media separable O(píxeles), bordes replicados; mismo algoritmo en Dart. */
export function mediaCaja(a:Float32Array,w:number,h:number,r:number):Float32Array {
 const tmp=new Float32Array(a.length),out=new Float32Array(a.length),n=2*r+1;
 for(let y=0;y<h;y++){
  let suma=0;for(let k=-r;k<=r;k++)suma+=a[y*w+limitar(k,0,w-1)];
  for(let x=0;x<w;x++){tmp[y*w+x]=suma/n;suma+=a[y*w+limitar(x+r+1,0,w-1)]-a[y*w+limitar(x-r,0,w-1)];}
 }
 for(let x=0;x<w;x++){
  let suma=0;for(let k=-r;k<=r;k++)suma+=tmp[limitar(k,0,h-1)*w+x];
  for(let y=0;y<h;y++){out[y*w+x]=suma/n;suma+=tmp[limitar(y+r+1,0,h-1)*w+x]-tmp[limitar(y-r,0,h-1)*w+x];}
 }
 return out;
}
export function muestra(a:ArrayLike<number>,w:number,h:number,c:number,x:number,y:number,k:number):number {
 x=limitar(x,0,w-1);y=limitar(y,0,h-1);const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const v=(px:number,py:number)=>a[(py*w+px)*c+k];
 return (v(ix,iy)*(1-fx)+v(Math.min(ix+1,w-1),iy)*fx)*(1-fy)+(v(ix,Math.min(iy+1,h-1))*(1-fx)+v(Math.min(ix+1,w-1),Math.min(iy+1,h-1))*fx)*fy;
}
