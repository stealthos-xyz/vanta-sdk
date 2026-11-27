import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createLiveFamilyHistoryReader,verifyLiveFamilyHistoryPublication} from '../fresh/family-shared-history.mjs';
import history from '../fresh/generated-family-history-checkpoint.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519'),key=publicKey.export({format:'der',type:'spki'}).toString('base64');
const now=1800000000000,scope={chainId:6281971,generationId:history.generationId,genesisHash:'0x'+'12'.repeat(32),setupId:'0x'+'34'.repeat(32)};
const pools=Object.keys(history.pools).sort(),anchor={number:history.anchor.number+100,hash:'0x'+'56'.repeat(32)};
const entry=record=>{const raw=Buffer.from(JSON.stringify(record));return{rawBytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),gzipBase64:gzipSync(raw).toString('base64')};};
function fixture(){
 const result={schema:'vanta-family-live-public-history-v1',networkId:history.networkId,generationId:scope.generationId,genesisHash:scope.genesisHash,setupId:scope.setupId,anchor,issuedAt:now/1000,pools:Object.fromEntries(pools.map(pool=>[pool,entry({scope:pool,anchor,nextRows:[32],encryptedRows:[],spentTransactions:[]})]))};
 result.signature=sign(null,Buffer.from(JSON.stringify(['STEALTHOS_VANTA_PUBLIC_HISTORY_V1',result.networkId,result.generationId,result.genesisHash,result.setupId,anchor.number,anchor.hash,result.issuedAt,pools.map(pool=>[pool,result.pools[pool].rawBytes,result.pools[pool].sha256])])),privateKey).toString('base64');
 return result;
}
test('signed live history is shared across assets, scoped and refreshed only once per minute',async()=>{
 let time=now,calls=0;const reader=createLiveFamilyHistoryReader({now:()=>time,publicKey:key,fetcher:async(url,options)=>{
  calls++;assert.match(url,/\/public\/v1\/vanta-history$/);assert.equal(options.credentials,'omit');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
  return Response.json(fixture());
 }});
 const results=await Promise.all(pools.map(pool=>reader({...scope,pool},0,history.anchor.number)));
 assert.equal(calls,1);assert.deepEqual(results.map(r=>r.scope),pools);
 assert.equal(await reader({...scope,pool:pools[0]},0,anchor.number),undefined);
 time+=59000;await reader({...scope,pool:pools[0]},0,0);assert.equal(calls,1);
 time+=1000;await reader({...scope,pool:pools[0]},0,0);assert.equal(calls,2);
});
test('bad signature, stale data, wrong generation and altered bytes are never accepted',async()=>{
 const context={...scope,pool:pools[0]},value=fixture();
 assert.equal(await verifyLiveFamilyHistoryPublication(value,context,{now,publicKey:key}),true);
 assert.equal(await verifyLiveFamilyHistoryPublication({...value,anchor:{...anchor,number:anchor.number+1}},context,{now,publicKey:key}),false);
 assert.equal(await verifyLiveFamilyHistoryPublication(value,context,{now:now+181000,publicKey:key}),false);
 assert.equal(await verifyLiveFamilyHistoryPublication(value,{...context,genesisHash:'0x'+'00'.repeat(32)},{now,publicKey:key}),false);
 const altered=fixture();altered.pools[pools[0]].gzipBase64=entry({anchor,scope:'tampered'}).gzipBase64;
 const reader=createLiveFamilyHistoryReader({now:()=>now,publicKey:key,fetcher:async()=>Response.json(altered)});
 assert.equal(await reader(context,0,0),undefined);
 const failed=createLiveFamilyHistoryReader({now:()=>now,publicKey:key,fetcher:async()=>new Response('unavailable',{status:503})});
 assert.equal(await failed(context,0,0),undefined);
});
