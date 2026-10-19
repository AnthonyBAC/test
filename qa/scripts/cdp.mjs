import fs from 'node:fs';
import {config} from './config.mjs';
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function browser(){
 const targets=await (await fetch(config.cdp+'/json')).json();
 const target=targets.find(t=>t.type==='page'&&t.url==='about:blank')||targets.find(t=>t.type==='page'&&t.url.startsWith(config.frontend));
 if(!target)throw Error('No se encuentra la página de prueba');
 const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
 await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async(expression,ms=20000)=>{const start=Date.now();while(Date.now()-start<ms){try{if(await evaluate(expression))return;}catch{}await delay(150)}throw Error('Condición no alcanzada: '+expression)};
 const navigate=async url=>{await send('Page.navigate',{url});await delay(150);await wait('document.readyState==="complete"');};
 const screenshot=async file=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(file,Buffer.from(r.data,'base64'));};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 return {send,evaluate,wait,navigate,screenshot,close:()=>ws.close()};
}
