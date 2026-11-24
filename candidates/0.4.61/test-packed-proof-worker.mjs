import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '/workspace/vanta-worker/heavy/qualified/scripts/family-qualification/node_modules/playwright/index.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const worker=await readFile('installed-candidate/package/fresh/unified-bound4-bootstrap-worker.js'),glue=await readFile('../note-engine.mjs'),wasm=await readFile('../note-engine.wasm');
assert.equal(sha(worker),'87040b79a3175d2d9905f57a8cf2537a450dc8277dd2ad96f0fd520c1f231cd6');
const report={schema:'vanta-packed-proof-worker-lifecycle-v1',safeForFunds:false,syntheticOnly:true,actualChromium:true,actualWasm:true,workerSha256:sha(worker),glueSha256:sha(glue),wasmSha256:sha(wasm),checks:[],externalRequests:0,passed:false};
const wrapper=`const original=globalThis.postMessage.bind(globalThis);let cleared=0;
for(const C of [Uint8Array,Int16Array]){
 const fill=C.prototype.fill;
 C.prototype.fill=function(v,...args){
  const tracked=(this instanceof Int16Array&&this.length===32&&this[0]===12345)||(this instanceof Uint8Array&&this.length===17&&this[0]===217);
  const r=fill.call(this,v,...args);
  if(tracked&&v===0&&this.every(x=>x===0))cleared++;
  return r;
 };
}
globalThis.postMessage=(data,transfer)=>{original(data,transfer);if(data?.id===3)original({type:'wipe-observation',cleared});};
await import('./proof-worker.js');original({type:'trace-ready'});`;
const browser=await chromium.launch({headless:true,executablePath:'/workspace/vanta-worker/heavy/toolchains/ms-playwright/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
try{
 const ctx=await browser.newContext();let failures=[];
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!=='https://proof-fixture.test'){report.externalRequests++;return route.abort();}
  const assets={'/proof-worker.js':['text/javascript',worker],'/trace-worker.js':['text/javascript',wrapper],'/runtime.js':['text/javascript',glue],'/runtime.wasm':['application/wasm',wasm]};
  if(assets[u.pathname])return route.fulfill({contentType:assets[u.pathname][0],body:assets[u.pathname][1]});
  return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Disposable worker lifecycle</title>'});
 });
 const page=await ctx.newPage();
 page.on('pageerror',e=>failures.push(String(e.message).slice(0,200)));
 page.on('console',m=>{if(m.text().includes('12345')||m.text().includes('CANARY_PRIVATE'))failures.push('canary in console');});
 await page.goto('https://proof-fixture.test/');
 const result=await page.evaluate(async({glueSha256,wasmSha256})=>{
  const g=new Uint8Array(await (await fetch('/runtime.js')).arrayBuffer()),w=new Uint8Array(await (await fetch('/runtime.wasm')).arrayBuffer()),checks=[];
  function ok(x,n){if(!x)throw Error(n);checks.push(n);}
  const worker=new Worker('/trace-worker.js',{type:'module'}),messages=[];
  let terminated=false;
  worker.onmessage=e=>messages.push(e.data);worker.onerror=e=>messages.push({type:'test-error',error:e.message});
  const wait=async predicate=>{const deadline=performance.now()+8000;while(performance.now()<deadline){const error=messages.find(x=>x.type==='test-error');if(error)throw Error('worker startup: '+error.error);const m=messages.find(predicate);if(m)return m;await new Promise(r=>setTimeout(r,10));}throw Error('worker response timeout');};
  const req=async(m,t=[])=>{worker.postMessage(m,t);return wait(x=>x.id===m.id);};
  try{
   await wait(x=>x.type==='trace-ready');
   worker.postMessage({type:'vanta-bound4-bootstrap',researchOnly:true,profileName:'8x5',glueUrl:location.origin+'/runtime.js',wasmUrl:location.origin+'/runtime.wasm',glueSha256,wasmSha256,glueBytes:g,wasmBytes:w},[g.buffer,w.buffer]);
   const ready=await wait(x=>x.type==='vanta-bound4-ready'||x.type==='vanta-bound4-fatal');
   ok(ready.type==='vanta-bound4-ready','exact packed worker initializes pinned real WASM');
   ok(g.byteLength===0&&w.byteLength===0,'runtime buffers transferred rather than duplicated');
   ok((await req({id:1,type:'init',width:8})).type==='success','worker accepts expected width');
   ok((await req({id:2,type:'start',curve:'G1',windowBits:10,from:0,to:1,points:1})).type==='success','real native MSM shard allocated');
   const query=new Uint8Array(17).fill(217),digits=new Int16Array(32).fill(12345);
   const rejected=await req({id:3,type:'push',query:query.buffer,digits:digits.buffer,pointStart:0,pointCount:1,privateMarker:'CANARY_PRIVATE'},[query.buffer,digits.buffer]);
   ok(query.byteLength===0&&digits.byteLength===0,'synthetic witness chunks transferred');
   ok(JSON.stringify(rejected)==='{"id":3,"type":"error"}','malformed witness produces generic error only');
   const observation=await wait(x=>x.type==='wipe-observation');
   ok(observation.cleared===2,'both private digit and query buffers wiped after native rejection');
   ok((await req({id:4,type:'finish'})).type==='error','failed session was released');
   ok((await req({id:5,type:'start',curve:'G1',windowBits:10,from:0,to:1,points:1})).type==='success','new shard works after failed session');
   worker.terminate();terminated=true;
   const count=messages.length;worker.postMessage({id:6,type:'finish',privateMarker:'CANARY_PRIVATE'});
   await new Promise(r=>setTimeout(r,150));ok(messages.length===count,'termination prevents further worker responses');
   ok(messages.every(x=>!JSON.stringify(x).includes('CANARY_PRIVATE')&&!JSON.stringify(x).includes('12345')),'no synthetic secret echo in worker messages');
   ok(localStorage.length===0&&sessionStorage.length===0&&(await indexedDB.databases()).length===0,'worker test creates no durable browser storage');
   return {passed:true,checks};
  }finally{if(!terminated)worker.terminate();}
 },{glueSha256:report.glueSha256,wasmSha256:report.wasmSha256});
 report.checks=result.checks;assert.ok(result.passed);assert.equal(report.externalRequests,0);assert.deepEqual(failures,[]);report.passed=true;
}catch(e){report.error=String(e.message).slice(0,350);process.exitCode=1;}
finally{await browser.close();await writeFile('packed-proof-worker-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
