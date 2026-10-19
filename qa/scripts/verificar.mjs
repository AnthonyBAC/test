import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {repoRoot} from './config.mjs';
for(const name of fs.readdirSync(path.join(repoRoot,'qa/scripts')).filter(n=>n.endsWith('.mjs'))){
 const check=spawnSync(process.execPath,['--check',path.join(repoRoot,'qa/scripts',name)],{stdio:'inherit'});
 if(check.status!==0)process.exit(check.status||1);
}
const tests=spawnSync(process.execPath,['--test',path.join(repoRoot,'qa/tests/herramientas.test.mjs')],{stdio:'inherit'});
process.exitCode=tests.status??1;
