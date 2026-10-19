import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {config,repoRoot,redact,escapeSqlLiteral,classifyCsrf,requireMutationConsent} from '../scripts/config.mjs';
import {parseCsv,summarizeJtl} from '../scripts/jtl.mjs';
const historical=path.join(repoRoot,'qa/evidencias/2026-10-19');
test('redacta credenciales y tokens también en objetos y listas anidados',()=>{
 const original={request:{password:'secreto',nombre:'QA'},response:[{token:'sesion',contrasena_hash:'hash'}]};
 assert.deepEqual(redact(original),{request:{password:'[omitido]',nombre:'QA'},response:[{token:'[omitido]',contrasena_hash:'[omitido]'}]});
 assert.equal(original.request.password,'secreto');
});
test('escapa comillas en la contraseña de la consulta QA',()=>assert.equal(escapeSqlLiteral("QA'abc"),"QA''abc"));
test('un rechazo sin token no aprueba protección CSRF',()=>{
 assert.equal(classifyCsrf(true)[0],'Parcial');assert.equal(classifyCsrf()[0],'Parcial');assert.equal(classifyCsrf(false)[0],'Fallido');
});
test('la fase que escribe datos requiere habilitación explícita',()=>{
 const previous=process.env.QA_ALLOW_MUTATIONS;delete process.env.QA_ALLOW_MUTATIONS;
 try{assert.throws(requireMutationConsent,/QA_ALLOW_MUTATIONS/);}finally{if(previous!==undefined)process.env.QA_ALLOW_MUTATIONS=previous;}
});
test('los archivos privados y resultados nuevos quedan fuera de las evidencias históricas',()=>{
 assert.ok(config.output.startsWith(path.join(repoRoot,'qa/results')));assert.ok(config.privateDir.startsWith(path.join(repoRoot,'qa/.private')));
});
test('lee JTL CSV con comas, comillas escapadas y saltos de línea entrecomillados',()=>{
 assert.deepEqual(parseCsv('a,b\r\n"uno,dos","dice ""hola""\ny sigue"\r\n'),[['a','b'],['uno,dos','dice "hola"\ny sigue']]);
 assert.throws(()=>parseCsv('a\n"incompleto'),/comillas/);
});
test('el resumen distingue hilos activos de errores HTTP y de aserción',()=>{
 const text='elapsed,success,responseCode,grpThreads\n10,true,200,2\n20,false,200,2\n30,true,500,1\n';
 const summary=summarizeJtl(text);assert.equal(summary.correctas,1);assert.equal(summary.errores,2);assert.equal(summary.maximo_hilos_activos,2);assert.equal(summary.promedio_ms,20);
});
test('el JTL real conserva las 1000 consultas sin errores y 200 hilos',()=>{
 const summary=summarizeJtl(fs.readFileSync(path.join(historical,'jmeter/CP-26.jtl'),'utf8'));
 assert.equal(summary.muestras,1000);assert.equal(summary.errores,0);assert.equal(summary.maximo_hilos_activos,200);assert.equal(summary.promedio_ms,4335.58);
});
test('el resumen revisado contiene los 30 casos, sin duplicarlos',()=>{
 const report=JSON.parse(fs.readFileSync(path.join(historical,'resumen-revisado.json'),'utf8'));
 assert.equal(new Set(report.casos.map(c=>c.id)).size,30);assert.equal(report.casos.length,30);
 for(const [state,count] of Object.entries({Aprobado:10,Fallido:15,Parcial:1,Bloqueado:4}))assert.equal(report.casos.filter(c=>c.estado===state).length,count);
 assert.equal(report.casos.find(c=>c.id==='CP-20').estado,'Parcial');assert.equal(report.casos.find(c=>c.id==='CP-19').estado,'Bloqueado');
});
test('los 16 incidentes continúan abiertos con la criticidad revisada',()=>{
 const {incidentes}=JSON.parse(fs.readFileSync(path.join(historical,'resumen-revisado.json'),'utf8'));
 assert.equal(incidentes.length,16);assert.equal(incidentes.filter(i=>i.criticidad==='Grave').length,9);assert.equal(incidentes.filter(i=>i.criticidad==='Moderado').length,7);assert.ok(incidentes.every(i=>i.estado==='Abierto'));
});
test('no se versionan contextos de sesión ni perfiles de navegador dentro de las evidencias',()=>{
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 const paths=walk(historical);assert.ok(paths.length>60);
 assert.ok(paths.every(p=>!/(contexto|credenciales|privado\.properties|edge-profile)/i.test(p)));
 for(const p of paths.filter(p=>p.endsWith('.json'))){
  const doc=JSON.parse(fs.readFileSync(p,'utf8'));
  const visit=value=>{if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){if(/^(token|password|contrasena_hash|authorization|secret)$/i.test(key))assert.equal(v,'[omitido]',p);else visit(v);}};
  visit(doc);
 }
});
test('el ejecutor de API se detiene antes de conectarse cuando no se habilitan cambios QA',()=>{
 const run=spawnSync(process.execPath,[path.join(repoRoot,'qa/scripts/api.mjs')],{encoding:'utf8',env:{...process.env,QA_ALLOW_MUTATIONS:'false'}});
 assert.notEqual(run.status,0);assert.match(run.stderr,/QA_ALLOW_MUTATIONS/);assert.equal(run.stdout,'');
});
test('las evidencias publicadas coinciden con su inventario SHA-256',()=>{
 const inventory=JSON.parse(fs.readFileSync(path.join(repoRoot,'qa/evidencias/inventario-publicado.json'),'utf8'));
 assert.ok(Object.keys(inventory).length>60);
 for(const [name,hash] of Object.entries(inventory))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(repoRoot,'qa/evidencias',name))).digest('hex'),hash,name);
});
