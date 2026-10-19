import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('CSV incompleto: comillas sin cerrar');
 if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
 return rows;
}
export function summarizeJtl(text){
 const [headers,...values]=parseCsv(text.replace(/^\uFEFF/,''));
 for(const key of ['elapsed','success','responseCode','grpThreads'])if(!headers?.includes(key))throw Error(`Falta columna JTL: ${key}`);
 const rows=values.map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i]])));
 if(!rows.length)throw Error('JTL sin muestras');
 const times=rows.map(r=>Number(r.elapsed));
 if(times.some(n=>!Number.isFinite(n)||n<0))throw Error('Tiempos JTL inválidos');
 const correct=rows.filter(r=>r.success==='true'&&r.responseCode==='200').length;
 return {muestras:rows.length,correctas:correct,errores:rows.length-correct,porcentaje_error:100*(rows.length-correct)/rows.length,promedio_ms:Number((times.reduce((a,b)=>a+b,0)/times.length).toFixed(2)),minimo_ms:Math.min(...times),maximo_ms:Math.max(...times),maximo_hilos_activos:Math.max(...rows.map(r=>Number(r.grpThreads))),alcance:'Hilos/usuarios virtuales activos; no mide por sí solo solicitudes HTTP exactamente en vuelo.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const input=process.argv[2];if(!input)throw Error('Uso: node qa/scripts/jtl.mjs ARCHIVO.jtl');
 console.log(JSON.stringify(summarizeJtl(fs.readFileSync(input,'utf8')),null,2));
}
