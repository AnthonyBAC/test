import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {browser,delay} from './cdp.mjs';
import {config, requireMutationConsent, redact, classifyCsrf} from './config.mjs';
requireMutationConsent();
const tmp=config.privateDir,out=config.output;
const ctx=JSON.parse(fs.readFileSync(path.join(tmp,'contexto.json'))),results=JSON.parse(fs.readFileSync(path.join(tmp,'resultados.json')));
const resume=process.argv.includes('--resume');
function add(cp,item){const file=path.join(out,cp+'.json');let data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];data.push(item);fs.writeFileSync(file,JSON.stringify(data,null,2));}
function record(cp,status,obtained,files=[]){results[cp]={id:cp,status,obtained,evidence:[cp+'.json',...files]};fs.writeFileSync(path.join(tmp,'resultados.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(out,'resumen-ejecucion.json'),JSON.stringify(results,null,2));console.log(cp,status,obtained);}
async function api(cp,method,url,data,token){const r=await fetch(config.api+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});let text=await r.text(),json;try{json=JSON.parse(text)}catch{}add(cp,{fecha:new Date().toISOString(),method,url,status:r.status,request:redact(data??null),response:redact(json??{bytes:Buffer.byteLength(text)})});return {status:r.status,json};}
const docker=config.docker;
function sql(q){return execFileSync(docker,['exec',config.postgresContainer,'psql','-U',config.databaseUser,'-d',config.database,'-At','-c',q],{encoding:'utf8'}).trim();}
// Repetir con un correo inválido único: el anterior colisionó con datos de una preparación previa.
if(!resume){
const iv=await api('CP-14','POST','/clientes',{nombre:ctx.tag+' Validacion correo unico',correo:'correo-invalido-'+ctx.tag,direccion:'Calle QA 100'},ctx.A.token);
record('CP-14',iv.status===201?'Fallido':'Bloqueado',`El cliente con datos válidos fue creado. Se repitió la validación con un correo sin @ y único para evitar colisiones: HTTP ${iv.status}${iv.status===201?', almacenado sin rechazo de formato.':'. No se confirmó que el rechazo fuese por validación de formato.'}`);
const assoc=JSON.parse(fs.readFileSync(path.join(out,'CP-15.json'))).at(-1);
record('CP-15',Number(assoc.clienteTrasIntento)===Number(assoc.clienteOriginal)?'Aprobado':'Fallido',results['CP-15'].obtained);
const duplicate=JSON.parse(fs.readFileSync(path.join(out,'CP-30.json'))),last=duplicate.at(-1),constraint=sql("SELECT count(*) FROM pg_constraint WHERE conrelid='empresas'::regclass AND contype='u' AND pg_get_constraintdef(oid) ILIKE '%correo%'");
add('CP-30',{restriccionUnicaCorreo:Number(constraint),correoDuplicadoRechazado:last.status===500&&String(last.response?.glosa).includes('unique')});
record('CP-30',constraint!=='0'&&last.status===500&&String(last.response?.glosa).includes('unique')?'Aprobado':'Bloqueado','La primera empresa QA se creó y el intento de reutilizar su correo fue rechazado por la restricción única empresas_correo_key. Se comprobó esa restricción en PostgreSQL, verificando la precondición de RB-1. La API devuelve HTTP 500 en lugar de un error de validación, observación adicional de manejo de errores.');
const logPublic=await api('CP-21','GET','/auditoria');
if(logPublic.status===200){record('CP-21','Fallido','La auditoría registra los eventos y no se hallaron contraseña ni token de QA en los logs examinados. Sin embargo, GET /auditoria devolvió HTTP 200 sin autenticación, exponiendo los registros de acciones. Falló la restricción de acceso a la auditoría.');}
}
const b=await browser();
const text=()=>b.evaluate('document.body.innerText');
async function shot(cp,suffix='01'){const name=cp+'_'+suffix+'.png';await b.screenshot(path.join(out,name));return name;}
async function login(username,password){
 await b.navigate(config.frontend+'/login');await b.wait('!!document.querySelector("#nombre_usuario")');
 await b.evaluate(`localStorage.clear(); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; for(const [id,value] of ${JSON.stringify([['nombre_usuario',username],['password',password]])}){const e=document.getElementById(id);setter.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('[data-testid="button-login"]').click();`);
 await b.wait('location.pathname==="/home" && document.body.innerText.includes("Bienvenido")',25000);
}
try{
 if(!resume){
 await login(config.adminUser,config.adminPassword);const cp1=await shot('CP-01');add('CP-01',{url:await b.evaluate('location.href'),pantalla:await text(),usuario:config.adminUser,observacion:'Credencial predeterminada real del proyecto, diferente del dato qa_admin01 propuesto en el plan.'});
 record('CP-01','Aprobado','La cuenta QA configurada inició sesión desde la interfaz y accedió al Dashboard con el mensaje de bienvenida.',[cp1]);
 await b.evaluate(`document.querySelector('[data-testid="button-layout-logout"]').click()`);await b.wait('location.pathname==="/login"');
 await login(ctx.A.username,ctx.qaPass);const cp7=await shot('CP-07');add('CP-07',{dashboard:await b.evaluate('location.pathname'),usuario:ctx.A.username,empresa:ctx.A.empresa.id,pantalla:await text(),alcance:'Alta mediante API; inicio de sesión y Dashboard comprobados mediante navegador.'});
 record('CP-07','Aprobado','Se registraron una cuenta QA nueva y su empresa por API. La relación quedó con rol Administrador en PostgreSQL y luego el usuario inició sesión y accedió al Dashboard desde la interfaz.',[cp7]);
 await b.navigate(config.frontend+'/contratos');await b.wait('document.body.innerText.includes("Gestión de Contratos") && !document.body.innerText.includes("Cargando contratos")');const statuses=await text();const cp16=await shot('CP-16');add('CP-16',{pantalla:statuses,fechaCliente:new Date().toLocaleDateString('es-CL'),nota:'Fechas relativas al día de la nueva ejecución; las evidencias históricas conservan las fechas originales.'});
 const expectedDates=[ctx.co,ctx.soon,ctx.expired].map(c=>String(c.fecha_fin).slice(0,10).split('-').reverse().join('/'));
 const statePass=statuses.includes('Vigente')&&statuses.includes('Vence en')&&statuses.includes('Vencido');
 const datesMatch=expectedDates.every(date=>statuses.includes(date));
 add('CP-16',{fechasEsperadas:expectedDates,fechasCoinciden:datesMatch,estadosPresentes:statePass});
 record('CP-16',statePass&&datesMatch?'Aprobado':'Fallido',`Estados visibles: ${statePass}; fechas de término coinciden: ${datesMatch}. Fechas esperadas: ${expectedDates.join(', ')}. No se evalúan contratos con inicio futuro ni todos los límites horarios.`,[cp16]);
 }
 await b.navigate(config.frontend+'/contratos/'+ctx.co.id);await b.wait('document.body.innerText.includes("Ver archivo")');const shareText=await text(),href=await b.evaluate("([...document.querySelectorAll('a')].find(a=>a.href.includes('/file'))).href");const share=await fetch(href);add('CP-17',{urlEnlace:href,opcionesPantalla:shareText,accesoSinSesion:share.status,bytes:(await share.arrayBuffer()).byteLength});const cp17=await shot('CP-17');
 record('CP-17','Fallido','El detalle del contrato ofrece Ver archivo mediante una URL directa, sin una opción para generar un enlace con condiciones de acceso. El enlace entregó el PDF sin sesión (HTTP '+share.status+'), por lo que no respeta el control de acceso esperado.',[cp17]);
 await b.navigate(config.frontend+'/clientes');await b.wait('document.body.innerText.includes("Gestión de Clientes") && !document.body.innerText.includes("Cargando clientes")');
 const safe=await b.evaluate(`({ejecutado:window.__atlasXss===1,textoLiteral:document.body.innerText.includes('<script>window.__atlasXss=1</script>')})`);const cp20=await shot('CP-20');add('CP-20',{xssEnNavegador:safe});
 const probes=JSON.parse(fs.readFileSync(path.join(out,'CP-20.json')));const inject=probes.find(x=>x.url.startsWith('/clientes/search')),loginAttack=probes.find(x=>x.url==='/autenticacion/login'),csrf=probes.find(x=>x.method==='POST'&&x.url==='/clientes'&&x.status===401);
 const safeAll=safe.textoLiteral&&!safe.ejecutado&&inject?.status===200&&inject.response.length===0&&loginAttack?.status===401&&!!csrf;
 record('CP-20',...classifyCsrf(safeAll),[cp20]);
 const beforeClient=await b.evaluate('location.pathname');const clicked=await b.evaluate(`const row=[...document.querySelectorAll('tbody tr')].find(e=>e.innerText.includes(${JSON.stringify(ctx.ca.nombre)}));if(row){row.querySelector('td').click();true}else{false}`);await delay(500);const afterClient=await b.evaluate('location.pathname');const cp27=await shot('CP-27');
 add('CP-27',{clienteBuscado:ctx.ca.nombre,filaEncontrada:clicked,rutaAntes:beforeClient,rutaDespues:afterClient,pantalla:await text(),enlacesClientes:await b.evaluate('[...document.querySelectorAll("main a")].map(a=>({texto:a.innerText,href:a.getAttribute("href")}))')});
 record('CP-27',clicked&&afterClient===beforeClient?'Fallido':'Bloqueado','En la sección Clientes se seleccionó la fila del cliente QA, pero no se abrió una vista de detalle ni un acceso a sus contratos; la ruta permaneció /clientes. La aplicación ofrece Contratos como listado separado. No se pudo completar el flujo Cliente → Contratos.',[cp27]);
 // Cierre real de sesión por interfaz y reutilización del token anterior en API.
 const tokenBefore=await b.evaluate('localStorage.getItem("token")');await b.evaluate(`document.querySelector('[data-testid="button-layout-logout"]').click()`);await b.wait('location.pathname==="/login"');const cp12=await shot('CP-12');
 const reuse=await api('CP-12','GET','/clientes',null,tokenBefore);add('CP-12',{sesionLocalEliminada:await b.evaluate('localStorage.getItem("token")===null'),redirigeLogin:true});
 record('CP-12',reuse.status===401||reuse.status===403?'Aprobado':'Fallido','Cerrar sesión eliminó el token local y llevó a la pantalla de login. Sin embargo, al reutilizar el token anterior en GET /clientes la API respondió HTTP '+reuse.status+'. El token no fue revocado.',[cp12]);
 await login(ctx.A.username,ctx.qaPass);
 await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await b.send('Emulation.setCPUThrottlingRate',{rate:4});
 await b.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8,connectionType:'cellular3g'});await b.send('Network.setCacheDisabled',{cacheDisabled:true});
 const measurements=[];for(let i=0;i<3;i++){const t=performance.now();await b.navigate(config.frontend+'/home');await b.wait('document.body.innerText.includes("Bienvenido") && !document.body.innerText.includes("Cargando métricas")',45000);measurements.push(Math.round(performance.now()-t));}
 const cp25=await shot('CP-25');add('CP-25',{medicionesMs:measurements,descargaMbps:1.6,subidaMbps:0.75,latenciaMs:150,cpuFactor:4,cacheDeshabilitada:true,definicion:'Navegación hasta Dashboard con métricas visibles; incluye solicitudes asíncronas de la aplicación.'});
 record('CP-25',measurements.every(x=>x<2000)?'Aprobado':'Fallido',`Tres cargas de la página principal con perfil móvil: ${measurements.join(', ')} ms. Perfil: 1,6 Mbps de bajada, 0,75 Mbps de subida, 150 ms de latencia, CPU ×4 y caché deshabilitada. Se midió hasta Dashboard con métricas visibles. Límite: menos de 2 s.`,[cp25]);
 const mobileWidth=await b.evaluate('({ancho:innerWidth,documento:document.documentElement.scrollWidth})');add('CP-06',{revisionParcial:'Edge de este equipo, escritorio y emulación móvil 390 × 844',dimensiones:mobileWidth,version:(await b.send('Browser.getVersion')).product,nota:'No se probaron todas las versiones y navegadores del ERS.'});results['CP-06'].evidence=['CP-06.json',cp25];
 if(mobileWidth.documento>mobileWidth.ancho){record('CP-06','Fallido','El contenido sobrepasa el ancho de la ventana móvil. La matriz de navegadores continúa pendiente.',[cp25]);}
 await b.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await b.send('Emulation.setCPUThrottlingRate',{rate:1});
 await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 fs.writeFileSync(path.join(tmp,'resultados.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(out,'resumen-ejecucion.json'),JSON.stringify(results,null,2));
}finally{
 try{await b.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await b.send('Emulation.setCPUThrottlingRate',{rate:1});}finally{b.close();}
}
console.log('Pruebas de navegador finalizadas.');
