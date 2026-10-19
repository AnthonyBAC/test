import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {config,repoRoot,requireMutationConsent} from './config.mjs';
const tool=process.argv[2];
const output=path.join(config.output,tool||'herramientas');fs.mkdirSync(output,{recursive:true});
function run(binary,args){const r=spawnSync(binary,args,{stdio:'inherit',cwd:repoRoot,env:process.env});if(r.error)throw r.error;if(r.status!==0)throw Error(`${path.basename(binary)} terminó con código ${r.status}`);}
const mount=(source,dest,ro=false)=>['--mount',`type=bind,source=${source},target=${dest}${ro?',readonly':''}`];
if(tool==='semgrep'){
 const common=['run','--rm',...mount(repoRoot,'/src',true),...mount(output,'/reports'),'semgrep/semgrep@sha256:529ee8a277ec8adc5b534d7c74eea0a47e9de21d62852b6ba7ac6ba9566845c3','semgrep','scan','--metrics','off','--exclude','node_modules','--exclude','.git','--exclude','dist','--exclude','qa','--exclude','*.sql','--exclude','.env*'];
 run(config.docker,[...common,'--config','p/javascript','--config','p/react','--config','p/secrets','--json','--output','/reports/semgrep-oficial.json','/src']);
 run(config.docker,[...common,'--config','/src/qa/semgrep/reglas-atlas.yml','--json','--output','/reports/semgrep-atlas.json','/src']);
}else if(tool==='sonarqube'){
 if(!process.env.SONAR_TOKEN)throw Error('Define SONAR_TOKEN en el entorno local');
 const server=process.env.SONAR_HOST_URL||'http://host.docker.internal:9000';
 run(config.docker,['run','--rm','-e','SONAR_TOKEN','-e',`SONAR_HOST_URL=${server}`,...mount(repoRoot,'/src',true),...mount(output,'/reports'),'sonarsource/sonar-scanner-cli@sha256:a3f4215076706c95a17a68c19322ee916e40a3acd081a8c1a1e839e0194afa57','-Dproject.settings=/src/qa/sonarqube/sonar-project.properties',...(process.env.SONAR_PROJECT_KEY?[`-Dsonar.projectKey=${process.env.SONAR_PROJECT_KEY}`]:[])]);
}else if(tool==='jmeter'||tool==='jmeter-report'){
 const home=process.env.JMETER_HOME;if(!home)throw Error('Define JMETER_HOME con la instalación de Apache JMeter 5.6.3');
 const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
 const jar=path.join(home,'bin/ApacheJMeter.jar');if(!fs.existsSync(jar))throw Error('No existe JMETER_HOME/bin/ApacheJMeter.jar');
 const dashboard=path.join(output,'dashboard');
 if(tool==='jmeter-report'){
  const input=path.resolve(process.argv[3]||path.join(repoRoot,'qa/evidencias/2026-10-19/jmeter/CP-26.jtl'));
  run(java,['-jar',jar,'-g',input,'-o',dashboard,'-Jjmeter.reportgenerator.overall_granularity=1000']);
 }else{
  requireMutationConsent();if(!config.adminPassword)throw Error('Define QA_ADMIN_PASSWORD para iniciar sesión QA');
  const r=await fetch(config.api+'/autenticacion/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre_usuario:config.adminUser,password:config.adminPassword}),signal:AbortSignal.timeout(30000)});
  const login=await r.json();if(!r.ok||!login.token)throw Error(`No se pudo iniciar sesión: HTTP ${r.status}`);
  fs.mkdirSync(config.privateDir,{recursive:true,mode:0o700});const privateFile=path.join(config.privateDir,'jmeter.properties');
  fs.writeFileSync(privateFile,`TOKEN=${login.token}\n`,{mode:0o600});
  const url=new URL(config.api);
  try{run(java,['-jar',jar,'-n','-t',path.join(repoRoot,'qa/jmeter/CP-26.jmx'),'-q',privateFile,`-JHOST=${url.hostname}`,`-JPORT=${url.port||(url.protocol==='https:'?'443':'80')}`,`-JPROTOCOL=${url.protocol.slice(0,-1)}`,'-l',path.join(output,'CP-26.jtl'),'-j',path.join(output,'jmeter.log'),'-e','-o',dashboard]);}finally{fs.rmSync(privateFile,{force:true});}
 }
}else throw Error('Herramienta desconocida: semgrep, sonarqube, jmeter o jmeter-report');
console.log(`Resultados nuevos: ${path.relative(repoRoot,output)}`);
