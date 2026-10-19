import {config} from './config.mjs';
import {execFileSync} from 'node:child_process';
const errors=[];
for(const [label,url] of [['API',config.api],['Frontend',config.frontend]]){
 try{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});await r.arrayBuffer();if(!r.ok)throw Error(`HTTP ${r.status}`);console.log(`${label}: HTTP ${r.status} en ${url}`);}catch(error){errors.push(`${label}: ${error.message}`);}
}
try{
 const health=execFileSync(config.docker,['inspect',config.postgresContainer,'--format','{{.State.Health.Status}}'],{encoding:'utf8'}).trim();
 if(health!=='healthy')throw Error(health);
 console.log('PostgreSQL: healthy');
}catch(error){errors.push(`PostgreSQL: ${error.message}`);}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
