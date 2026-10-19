import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

export const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const latest=path.join(repoRoot,'qa/results/ultima-ejecucion.json');
const browserMode=process.argv[1]?.endsWith('navegador.mjs');
let runId=process.env.QA_RUN_ID;
if(!runId&&browserMode&&fs.existsSync(latest)) runId=JSON.parse(fs.readFileSync(latest,'utf8')).runId;
runId??=new Date().toISOString().replaceAll(/[:.]/g,'-');
if(!/^[a-zA-Z0-9_-]+$/.test(runId)) throw Error('QA_RUN_ID solo admite letras, números, guiones y guiones bajos');
function localUrl(value){
 const url=new URL(value);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('Las pruebas de Atlas están limitadas al entorno local');
 return url.href.replace(/\/$/,'');
}
const day=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const config={
 api:localUrl(process.env.QA_API_URL||'http://localhost:4450'),
 frontend:localUrl(process.env.QA_FRONTEND_URL||'http://localhost:3350'),
 cdp:localUrl(process.env.QA_CDP_URL||'http://localhost:9227'),
 docker:process.env.QA_DOCKER||'docker',
 postgresContainer:process.env.QA_POSTGRES_CONTAINER||'atlas-postgres',
 database:process.env.QA_POSTGRES_DB||'atlas',
 databaseUser:process.env.QA_POSTGRES_USER||'postgres',
 adminUser:process.env.QA_ADMIN_USER||'admin',
 adminPassword:process.env.QA_ADMIN_PASSWORD,
 qaPassword:process.env.QA_PASSWORD||'AtlasQA#'+randomBytes(16).toString('hex'),
 runId,output:path.join(repoRoot,'qa/results',runId),
 privateDir:path.join(repoRoot,'qa/.private',runId),
 dates:{start:day(-30),future:day(90),expired:day(-2),soon:day(5)}
};
export function requireMutationConsent(){
 if(process.env.QA_ALLOW_MUTATIONS!=='true') throw Error('Define QA_ALLOW_MUTATIONS=true para crear los datos ficticios y ejecutar la carga en el entorno local de evaluación');
}
export function prepareRun(){
 fs.mkdirSync(config.output,{recursive:true});fs.mkdirSync(config.privateDir,{recursive:true,mode:0o700});
 fs.writeFileSync(latest,JSON.stringify({runId:config.runId},null,2)+'\n');
}
export function redact(value){
 return JSON.parse(JSON.stringify(value,(key,item)=>/token|password|contrasena_hash|secret|authorization/i.test(key)?'[omitido]':typeof item==='string'?item.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[token omitido]'):item));
}
export const escapeSqlLiteral=value=>String(value).replaceAll("'","''");
export function classifyCsrf(basicChecksPassed){
 return [basicChecksPassed===false?'Fallido':'Parcial',basicChecksPassed===false?'Las comprobaciones básicas de XSS/SQL no cumplieron el resultado esperado. La protección CSRF requiere validación adicional.':'Comprobaciones básicas de XSS/SQL y autenticación; CSRF no validado de forma concluyente. Un 401 sin token no demuestra protección CSRF con una sesión válida.'];
}
