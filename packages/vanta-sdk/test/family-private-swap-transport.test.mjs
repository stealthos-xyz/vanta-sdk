/** Exercise the actual emitted SDK broker, not a gateway-only mock. */
import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
const source=await readFile(new URL('../browser/app-wallet.mjs',import.meta.url),'utf8'),literal=source.match(/var PATH = (\/.*\/u);/u)[1],PATH=new Function('return '+literal)();
const start=source.indexOf('  const authFetch = '),end=source.indexOf('  const send = ',start),expression=source.slice(start+'  const authFetch = '.length,end).trim();
test('sealed browser broker authenticates all output endpoints and rejects unknown/normal output paths',async()=>{
 const calls=[],wallet='0x'+'11'.repeat(20),deps={disposed:false,PATH,selected:async()=>wallet,unavailable:()=>Error('rejected'),authorization:async()=>'Bearer fixture',sessionBearer:'Bearer fixture',stop:()=>{throw Error('stopped');},readFamilyRelayRouting:()=>null,assertFamilyRelayContext:()=>{},familyRelayRoutingHeaders:()=>({}),opened:{context:{}},origin:'https://app.example',fetch:async(url,init)=>{calls.push({url,init});return Response.json({transactionHash:null});}};
 const run=new Function(...Object.keys(deps),'return '+expression)(...Object.values(deps));
 for(const operation of['output-relayer','output-submit','output-status']){assert.equal((await run('/api/vanta-v8/routed/'+operation,'{}',wallet)).status,200);assert.equal(calls.at(-1).init.headers.Authorization,'Bearer fixture');}
 for(const path of['/api/vanta-v8/normal/output-submit','/api/vanta-v8/routed/arbitrary-call'])await assert.rejects(run(path,'{}',wallet),/rejected/);
 assert.equal(calls.length,3);await assert.rejects(run('/api/vanta-v8/routed/output-submit','{}','0x'+'22'.repeat(20)),/rejected/);assert.equal(calls.length,3);
});
