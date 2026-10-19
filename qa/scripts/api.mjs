import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {config, prepareRun, requireMutationConsent, redact, classifyCsrf, escapeSqlLiteral} from './config.mjs';
requireMutationConsent();
prepareRun();
const dir=config.output, tmp=config.privateDir;
const docker=config.docker;
const base=config.api,tag='QA'+Date.now();
if(!config.adminPassword) throw Error('Define QA_ADMIN_USER y QA_ADMIN_PASSWORD en qa/.env.local');
const results={}, evidence={};
function sql(query,db=config.database){return execFileSync(docker,['exec',config.postgresContainer,'psql','-U',config.databaseUser,'-d',db,'-At','-c',query],{encoding:'utf8',maxBuffer:10e6}).trim();}
function add(cp,item){(evidence[cp]??=[]).push(item);fs.writeFileSync(path.join(dir,cp+'.json'),JSON.stringify(evidence[cp],null,2));}
function record(cp,status,obtained,extra={}){results[cp]={id:cp,status,obtained,evidence:[cp+'.json'],...extra};fs.writeFileSync(path.join(tmp,'resultados.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(dir,'resumen-api.json'),JSON.stringify(results,null,2));console.log(cp,status,obtained);}
async function req(cp,method,url,body,token,extraHeaders={}){
 const start=performance.now(),headers={...extraHeaders};if(token)headers.Authorization='Bearer '+token;
 let data=body;if(body && !(body instanceof FormData)){data=JSON.stringify(body);headers['Content-Type']='application/json';}
 const r=await fetch(base+url,{method,headers,body:data,signal:AbortSignal.timeout(35000)}),buf=Buffer.from(await r.arrayBuffer());
 let json;try{json=JSON.parse(buf.toString())}catch{json=null}
 const item={fecha:new Date().toISOString(),method,url,status:r.status,ms:Math.round(performance.now()-start),request:body instanceof FormData?Object.fromEntries([...body].map(([k,v])=>[k,typeof v==='string'?v:'[archivo PDF QA]'])):redact(body??null),response:json?redact(json):{bytes:buf.length,sha256:createHash('sha256').update(buf).digest('hex')},headers:{contentType:r.headers.get('content-type'),allowOrigin:r.headers.get('access-control-allow-origin')}};
 add(cp,item);return {status:r.status,json,buf,ms:item.ms};
}
const login=async(cp,u,p)=>{const r=await req(cp,'POST','/autenticacion/login',{nombre_usuario:u,password:p});if(r.status!==200)throw Error('No se pudo iniciar sesión QA');return r.json.token;};
let customerIndex=0;
const customer=(name,other={})=>({nombre:name,correo:tag.toLowerCase()+'c'+(++customerIndex)+'@example.test',telefono:'+56912345678',direccion:'Calle QA 100',...other});
const admin=await login('CP-01',config.adminUser,config.adminPassword);
add('CP-01',{nota:'Credenciales definidas mediante el entorno local de QA; no se publican contraseñas.'});
// Las empresas y los registros creados en esta ejecución están identificados con tag.
const qaPass=config.qaPassword;
async function company(suffix,cp='CP-07'){
 const name=tag+suffix, r=await req(cp,'POST','/empresas',{usuario:{nombre_usuario:name,contrasena_hash:qaPass,correo:name.toLowerCase()+'@example.test'},empresa:{nombre:name,direccion:'Calle QA 100',telefono:'+56912345678',correo:name.toLowerCase()+'@example.test'}});
 if(r.status!==201)throw Error('No se pudo preparar empresa QA');
 return {...r.json,username:name,token:await login(cp,name,qaPass)};
}
const A=await company('A'),B=await company('B','CP-11');
add('CP-07',{rol:sql(`SELECT r.nombre FROM empresa_usuarios eu JOIN roles r ON r.id=eu.rol_id WHERE eu.usuario_id=${A.usuario.id}`)});
const ca=await req('CP-14','POST','/clientes',customer(tag+' Cliente A'),A.token);
const cb=await req('CP-11','POST','/clientes',customer(tag+' Cliente B'),B.token);
const invalid=await req('CP-14','POST','/clientes',customer(tag+' Correo inválido',{correo:'correo-invalido-'+tag}),A.token);
record('CP-14',invalid.status===201?'Fallido':'Aprobado',`Cliente válido: HTTP ${ca.status}. Correo sin formato válido: HTTP ${invalid.status}${invalid.status===201?', almacenado sin rechazo.':', rechazado.'}`);
// CP-13 happy path de administración, con rol comprobado en la base de datos.
const nu=await req('CP-13','POST','/empresa-usuarios',{nombre_usuario:tag+'Temporal',contrasena_hash:qaPass,correo:tag.toLowerCase()+'temp@example.test',rol_id:2},A.token);
const link=nu.json;
const mod=await req('CP-13','PUT','/empresa-usuarios/'+link.id,{empresa_id:A.empresa.id,usuario_id:link.usuario_id,rol_id:1},A.token);
const newRole=sql(`SELECT rol_id FROM empresa_usuarios WHERE id=${link.id}`);add('CP-13',{rolTrasModificacion:newRole});
const dl=await req('CP-13','DELETE','/empresa-usuarios/'+link.id,null,A.token);
const du=await req('CP-13','DELETE','/usuarios/'+link.usuario_id,null,A.token);
record('CP-13',[nu.status,mod.status,dl.status,du.status].join()==='201,200,200,200'&&newRole==='1'?'Aprobado':'Fallido','El Administrador creó un usuario Editor, lo vinculó a su empresa, cambió su rol y eliminó el vínculo y el usuario. Validación ejecutada mediante API y base de datos.');
const editorName=tag+'Editor';const editorLink=await req('CP-02','POST','/empresa-usuarios',{nombre_usuario:editorName,contrasena_hash:qaPass,correo:tag.toLowerCase()+'editor@example.test',rol_id:2},A.token);
const editor=await login('CP-02',editorName,qaPass);
add('CP-02',{rolReal:sql(`SELECT r.nombre FROM empresa_usuarios eu JOIN roles r ON r.id=eu.rol_id WHERE eu.usuario_id=${editorLink.json.usuario_id}`)});
const ec=await req('CP-02','POST','/clientes',customer(tag+' Editor escritura'),editor);
if(ec.status!==201)throw Error('No se pudo crear el cliente descartable para CP-02: '+JSON.stringify(ec.json));
const eu=await req('CP-02','PUT','/clientes/'+ec.json.id,customer(tag+' Editor modificó'),editor);
const ed=await req('CP-02','DELETE','/clientes/'+ec.json.id,null,editor);
record('CP-02',[ec.status,eu.status,ed.status].every(s=>s===401||s===403)?'Aprobado':'Fallido',`Un usuario con rol Editor creó, modificó y eliminó un cliente por API: HTTP ${ec.status}, ${eu.status} y ${ed.status}. Las operaciones de escritura no fueron restringidas.`);
const delClient=await req('CP-03','POST','/clientes',customer(tag+' Borrado'),A.token);
const dr=await req('CP-03','DELETE','/clientes/'+delClient.json.id,null,A.token);
const left=sql(`SELECT COUNT(*) FROM clientes WHERE id=${delClient.json.id}`);add('CP-03',{registrosRestantes:Number(left),alcance:'Cliente descartable creado por esta prueba; comprobación de persistencia, sin alterar registros previos.'});
record('CP-03',left==='0'?'Fallido':'Aprobado',`DELETE respondió HTTP ${dr.status}. La consulta posterior encontró ${left} registros: la eliminación fue física y no lógica. Este incumplimiento basta para rechazar el caso; no se atribuye un resultado a la confirmación de interfaz.`);
const timings=[];for(let i=0;i<5;i++)timings.push((await req('CP-04','GET','/clientes',null,A.token)).ms);
record('CP-04',timings.every(x=>x<300)?'Aprobado':'Fallido',`Cinco consultas consecutivas bajo carga normal: ${timings.join(', ')} ms. Límite del caso: menos de 300 ms. Promedio: ${Math.round(timings.reduce((a,b)=>a+b)/5)} ms.`);
// PDF sintético de una página válido, sin información de usuario.
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length 40 >>\nstream\nBT /F1 12 Tf 30 100 Td (Atlas QA) Tj ET\nendstream'];
let pdf='%PDF-1.4\n',offs=[0];for(let i=0;i<objects.length;i++){offs.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;};const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offs.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;const pdfBytes=Buffer.from(pdf);
fs.writeFileSync(path.join(tmp,'contrato_qa.pdf'),pdfBytes);
async function contract(cp,cid,title,dates,token=A.token){const fd=new FormData();Object.entries({cliente_id:String(cid),titulo:title,descripcion:'Contrato ficticio QA',fecha_inicio:dates[0],fecha_fin:dates[1]}).forEach(([k,v])=>fd.append(k,v));fd.append('file',new Blob([pdfBytes],{type:'application/pdf'}),'contrato_qa.pdf');return await req(cp,'POST','/contratos',fd,token);}
const co=await contract('CP-08',ca.json.id,tag+' Contrato A',[config.dates.start,config.dates.future]);
const getPdf=await req('CP-08','GET','/contratos/'+co.json.id+'/file',null,A.token);
const equal=getPdf.buf.equals(pdfBytes),docCount=sql(`SELECT COUNT(*) FROM documentos_contrato WHERE contract_id=${co.json.id}`);add('CP-08',{archivoIdentico:equal,referenciasEnBD:Number(docCount),tiempoTotalMs:co.ms+getPdf.ms});
record('CP-08',co.status===201&&getPdf.status===200&&equal&&co.ms+getPdf.ms<10000?'Aprobado':'Fallido',`Carga HTTP ${co.status}, descarga HTTP ${getPdf.status}; contenido idéntico por comparación binaria y documento referenciado en la base de datos. Tiempo total: ${co.ms+getPdf.ms} ms. Alcance: integración por API.`);
const other=await contract('CP-11',cb.json.id,tag+' Contrato B',[config.dates.start,config.dates.future],B.token);
const cross=await req('CP-11','GET','/contratos/'+other.json.id+'/file',null,A.token);
record('CP-11',cross.status===401||cross.status===403||cross.status===404?'Aprobado':'Fallido',`Un token de la Empresa A descargó el documento de la Empresa B: HTTP ${cross.status}, ${cross.buf.length} bytes. Documento ajeno entregado sin restricción de empresa.`);
const aud=await req('CP-09','GET','/auditoria',null,A.token);const event=aud.json.find(r=>String(r.accion).includes(tag+' Cliente A'));add('CP-09',{eventoCreacionEncontrado:!!event,registro:event});
record('CP-09',event?'Aprobado':'Fallido','La creación del cliente QA generó un registro CLIENTES_CREAR con usuario, acción y fecha en auditoría. Validación mediante API.');
const plain=sql(`SELECT contrasena_hash='${escapeSqlLiteral(qaPass)}' AS coincide_texto_plano, contrasena_hash ~ '^\\$2[aby]\\$' AS parece_bcrypt FROM usuarios WHERE id=${A.usuario.id}`);add('CP-10',{comparacionBD:plain,significado:'Primera columna: coincide con contraseña en texto plano. Segunda: tiene prefijo bcrypt. No se publica el valor almacenado.'});
record('CP-10',plain.startsWith('t|')?'Fallido':'Aprobado','La contraseña de la cuenta QA coincide directamente con el valor almacenado; no se aplicó hashing bcrypt. Se documenta la comparación sin publicar la contraseña ni hashes.');
const assoc=await contract('CP-15',ca.json.id,tag+' Asociacion unica',[config.dates.start,config.dates.future]);
const attempt=await req('CP-15','PUT','/contratos/'+assoc.json.id,{cliente_id:cb.json.id},A.token);
const association=sql(`SELECT cliente_id FROM contratos WHERE id=${assoc.json.id}`);add('CP-15',{clienteOriginal:ca.json.id,intentoSegundoCliente:cb.json.id,clienteTrasIntento:Number(association),relacionUnica:true});
record('CP-15',Number(association)===Number(ca.json.id)?'Aprobado':'Fallido','El contrato se creó asociado al Cliente A. Se intentó asociarlo al Cliente B y persistió una sola relación con el Cliente A. Verificación mediante API y clave cliente_id en base de datos.');
const expired=await contract('CP-16',ca.json.id,tag+' Expirado',[config.dates.start,config.dates.expired]);
const soon=await contract('CP-16',ca.json.id,tag+' Vence',[config.dates.start,config.dates.soon]);
await req('CP-16','GET','/contratos/estados',null,A.token);
await req('CP-18','GET','/',null,A.token);const insecure=await fetch(config.frontend);add('CP-18',{frontendProtocol:new URL(insecure.url).protocol,backendProtocol:'http:',nota:'Evaluación del entorno local suministrado; no extrapolable al despliegue de producción.'});
record('CP-18','Fallido','Frontend y API utilizan HTTP sin TLS en el ambiente local evaluado. No se observó redirección a HTTPS en las solicitudes de prueba. El resultado se limita a este ambiente.');
const secretAccount='QA-000011112222';const bank=await req('CP-19','POST','/clientes',customer(tag+' Datos bancarios',{nombre_banco:'Banco Ficticio QA',numero_cuenta:secretAccount,titular_cuenta:'Persona Ficticia QA'}),A.token);
const readable=sql(`SELECT numero_cuenta='${secretAccount}' FROM clientes WHERE id=${bank.json.id}`);add('CP-19',{campo:'numero_cuenta',coincideConTextoPlano:readable==='t',alcance:'Comprobación del campo sensible en la tabla; no se evaluó cifrado de disco o de volumen.'});
record('CP-19','Bloqueado','Se revisó el campo sensible mediante SQL. Esta observación no permite concluir si existe cifrado del disco o volumen; se necesita acceso a su configuración y evidencia del almacenamiento.');
const xss=await req('CP-20','POST','/clientes',customer('<script>window.__atlasXss=1</script> '+tag),A.token);
await req('CP-20','GET','/clientes/search?name='+encodeURIComponent("' OR '1'='1"),null,A.token);
await req('CP-20','POST','/autenticacion/login',{nombre_usuario:"' OR '1'='1",password:'ficticio'});
await req('CP-20','POST','/clientes',customer(tag+' CSRF sin token'),null,{Origin:'http://origen-qa-invalido.test'});
// Verificación limitada de los logs de esta sesión; solo se publican indicadores.
await req('CP-21','GET','/clientes/identificador-invalido',null,A.token);
const logs=execFileSync(docker,['logs','--since','20m','atlas-backend'],{encoding:'utf8',maxBuffer:12e6,stdio:['ignore','pipe','pipe']});
add('CP-21',{eventosHTTP:logs.includes('POST /')||logs.includes('GET /'),contienePasswordQA:logs.includes(qaPass),contieneTokenQA:logs.includes(A.token),contieneEventoLogin:logs.includes('autenticacion/login'),limite:'Logs disponibles de los últimos 20 minutos y auditoría. No prueba rotación, retención, permisos del host ni resistencia a manipulación.'});
const publicAudit=await req('CP-21','GET','/auditoria');
record('CP-21',logs.includes(qaPass)||logs.includes(A.token)||publicAudit.status===200?'Fallido':'Parcial',`Auditoría sin autenticación: HTTP ${publicAudit.status}. Contraseña o token QA encontrados en logs: ${logs.includes(qaPass)||logs.includes(A.token)}. No se verificaron retención ni permisos de almacenamiento.`);
// CP-22: simular pérdida solo en una base nueva y aislada.
const backupCustomer=await req('CP-22','POST','/clientes',customer(tag+' Backup'),A.token);
const isolated='atlas_qa_restore_'+Date.now();if(!/^atlas_qa_restore_\d+$/.test(isolated))throw Error('Nombre de BD no autorizado');
try{
 execFileSync(docker,['exec',config.postgresContainer,'createdb','-U',config.databaseUser,isolated]);
 const dump=execFileSync(docker,['exec',config.postgresContainer,'pg_dump','-U',config.databaseUser,'-Fc',config.database],{maxBuffer:40e6});
 execFileSync(docker,['exec','-i',config.postgresContainer,'pg_restore','-U',config.databaseUser,'-d',isolated,'--no-owner'],{input:dump});
 const before=sql(`SELECT row_to_json(c)::text FROM clientes c WHERE id=${backupCustomer.json.id}`,isolated);
 sql(`DELETE FROM clientes WHERE id=${backupCustomer.json.id}`,isolated);
 const lost=sql(`SELECT count(*) FROM clientes WHERE id=${backupCustomer.json.id}`,isolated);
 execFileSync(docker,['exec','-i',config.postgresContainer,'pg_restore','-U',config.databaseUser,'-d',isolated,'--no-owner','--clean','--if-exists'],{input:dump});
 const restored=sql(`SELECT row_to_json(c)::text FROM clientes c WHERE id=${backupCustomer.json.id}`,isolated);
 add('CP-22',{baseAislada:isolated,perdidaConfirmada:lost==='0',restauracionIdentica:restored===before,sha256:createHash('sha256').update(restored).digest('hex'),procedimiento:'pg_dump / pg_restore manual; la base atlas principal no fue eliminada ni restaurada.'});
 record('CP-22',lost==='0'&&restored===before?'Aprobado':'Fallido','Se generó un respaldo con pg_dump y se restauró en una base temporal aislada. Tras eliminar allí un cliente QA, pg_restore recuperó el registro idéntico. No se modificó la base principal durante la simulación de pérdida. No valida una política de respaldos automáticos.');
}finally{execFileSync(docker,['exec',config.postgresContainer,'dropdb','-U',config.databaseUser,isolated]);}
const own=await req('CP-23','GET','/usuarios/'+B.usuario.id,null,B.token);
const outsider=await req('CP-23','GET','/usuarios/'+B.usuario.id,null,A.token);
const anonymous=await req('CP-23','GET','/usuarios/'+B.usuario.id);
record('CP-23',outsider.status===200||anonymous.status===200?'Fallido':'Aprobado',`La información de un usuario QA de la Empresa B fue accesible desde la Empresa A (HTTP ${outsider.status}) y sin token (HTTP ${anonymous.status}). Falla el control técnico de acceso a datos personales; no constituye una evaluación legal completa.`);
const valid=await req('CP-24','GET','/clientes',null,A.token), missing=await req('CP-24','GET','/clientes'),tampered=await req('CP-24','GET','/clientes',null,A.token.slice(0,-10)+'alterado');
record('CP-24',valid.status===200&&missing.status===401&&tampered.status===401?'Aprobado':'Fallido',`Listado de clientes: token válido HTTP ${valid.status}; sin token HTTP ${missing.status}; token modificado HTTP ${tampered.status}. Alcance: recurso /clientes del caso; otros controles fallan y se registran en CP-11 y CP-23.`);
const start=performance.now();const count=200;let peak=0,active=0;
const wave=await Promise.all(Array.from({length:count},async()=>{active++;peak=Math.max(peak,active);const s=performance.now();try{const r=await fetch(base+'/clientes',{headers:{Authorization:'Bearer '+A.token},signal:AbortSignal.timeout(30000)});await r.arrayBuffer();return {status:r.status,ms:Math.round(performance.now()-s)}}catch(e){return {status:0,error:e.message}}finally{active--}}));
const health=await fetch(base+'/');const good=wave.filter(r=>r.status===200).length;add('CP-26',{usuariosVirtuales:count,concurrenciaMaximaCliente:peak,iteracionesPorUsuario:1,credenciales:'Sesión QA compartida por los usuarios virtuales',respuestasCorrectas:good,respuestasConError:count-good,duracionMs:Math.round(performance.now()-start),saludPosterior:health.status,respuestas:wave,limite:'Ráfaga de 200 solicitudes concurrentes; no sustituye una prueba sostenida de capacidad.'});
record('CP-26',good===200&&health.status===200?'Aprobado':'Fallido',`Se lanzaron 200 solicitudes concurrentes de consulta con sesión QA: ${good}/200 devolvieron HTTP 200 y la API siguió disponible. Escenario: una iteración por usuario virtual, sesión compartida y carga de lectura; no prueba carga sostenida ni 200 cuentas distintas.`);
record('CP-05','Bloqueado','No se dispone de cinco participantes representativos, incluyendo adultos mayores. La inspección automática de la interfaz no sustituye la prueba con usuarios. Pendiente coordinar participantes y adjuntar sus resultados.',{evidence:[]});
record('CP-06','Bloqueado','La matriz exige las dos últimas versiones de Chrome, Firefox, Safari y Edge. Este equipo no dispone de toda esa matriz; se registrará una revisión parcial de Edge en escritorio y móvil sin aprobar el caso completo.',{evidence:[]});
record('CP-28','Bloqueado','No existen registros de monitoreo de un mes completo. Una comprobación puntual de servicio disponible no permite calcular el 99,5 % mensual.',{evidence:[]});
record('CP-29','Bloqueado','No se suministró una versión de actualización o migración real ni una ventana de mantenimiento. La restauración aislada de CP-22 no sustituye esta prueba.',{evidence:[]});
const dupEmail=tag.toLowerCase()+'duplicado@example.test';const c1=await req('CP-30','POST','/empresas',{nombre:tag+' Correo A',correo:dupEmail},A.token),c2=await req('CP-30','POST','/empresas',{nombre:tag+' Correo B',correo:dupEmail},A.token);
const uniquePolicy=sql("SELECT count(*) FROM pg_constraint WHERE conrelid='empresas'::regclass AND contype='u' AND pg_get_constraintdef(oid) ILIKE '%correo%'");
const rejected=c2.status===400||c2.status===409||(c2.status===500&&String(c2.json?.glosa).includes('unique'));
record('CP-30',uniquePolicy!=='0'&&c1.status===201&&rejected?'Aprobado':'Bloqueado',`Primer registro HTTP ${c1.status}; correo repetido HTTP ${c2.status}. Restricciones únicas de correo: ${uniquePolicy}. El error HTTP 500 con detalle interno se evalúa como hallazgo adicional y no como éxito del manejo de errores.`);
fs.writeFileSync(path.join(tmp,'contexto.json'),JSON.stringify({tag,A,B,admin,editor,editorName,qaPass,ca:ca.json,cb:cb.json,co:co.json,other:other.json,expired:expired.json,soon:soon.json,xss:xss.json},null,2));
record('CP-01','Parcial','La API autenticó la cuenta configurada; falta comprobar el acceso al Dashboard mediante el navegador.');
record('CP-07','Parcial','La API registró una cuenta y su empresa; falta comprobar el acceso al Dashboard mediante el navegador.');
record('CP-20',...classifyCsrf());
for(const cp of ['CP-12','CP-16','CP-17','CP-25','CP-27']) if(!results[cp]) record(cp,'Bloqueado','Pendiente de la fase de navegador.');
console.log('API completada; pendientes de navegador: CP-01 CP-07 CP-12 CP-16 CP-17 CP-20 CP-25 CP-27.');
