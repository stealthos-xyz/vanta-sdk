import test from 'node:test';
import assert from 'node:assert/strict';
import {readFamilyLogWindow,readFamilyLogRange,routeFamilyRpcPayload,canonicalFamilyProvider,createFamilyRpcProviders} from '../fresh/family-rpc.mjs';
const p=(method,id=1)=>({jsonrpc:'2.0',method,id,params:[]});
const result=payload=>(Array.isArray(payload)?payload:[payload]).map(r=>({id:r.id,result:'ok'}));
test('healthy read batches use primary only and isolate log reads',async()=>{
 const calls=[];let fallback=0;
 const primary=async x=>{calls.push(x);return result(x);},backup=async x=>{fallback++;return result(x);};
 await routeFamilyRpcPayload([p('eth_call'),p('eth_getBlockByNumber',2)],primary,backup);
 assert.equal(calls.length,1);assert.equal(fallback,0);
 await routeFamilyRpcPayload([p('eth_getLogs'),p('eth_call',2)],primary,backup);
 assert.equal(calls.length,3);assert.ok(calls.slice(1).every(x=>!Array.isArray(x)));assert.equal(fallback,0);
});
test('only failed safe reads fail over; writes and semantic errors never do',async()=>{
 let backup=0;const second=async x=>{backup++;return result(x);};
 const failed=async()=>{throw Object.assign(Error('timed out'),{code:'TIMEOUT'});};
 assert.deepEqual(await routeFamilyRpcPayload(p('eth_call'),failed,second),[{id:1,result:'ok'}]);
 await assert.rejects(routeFamilyRpcPayload(p('eth_sendRawTransaction'),failed,second));
 const revert=async()=>[{id:1,error:{code:3,message:'execution reverted'}}];
 assert.equal((await routeFamilyRpcPayload(p('eth_call'),revert,second))[0].error.code,3);
 const limited=async()=>[{id:1,error:{code:-32062,message:'block range too large'}}];
 assert.equal((await routeFamilyRpcPayload(p('eth_getLogs'),limited,second))[0].error.code,-32062);
 assert.equal(backup,1);
});
test('unsupported batches retry individual primary reads without fallback',async()=>{
 let n=0;const primary=async x=>{n++;if(Array.isArray(x))throw Error('batch not supported');return result(x);};
 const response=await routeFamilyRpcPayload([p('eth_call'),p('eth_getCode',2)],primary,()=>{throw Error('unexpected fallback');});
 assert.equal(n,3);assert.equal(response.length,2);
});
test('adaptive windows are contiguous; non-range failures are not suppressed',async()=>{
 const calls=[];const logs=await readFamilyLogRange({getLogs:async({fromBlock,toBlock})=>{
  if(toBlock-fromBlock+1>400)throw Object.assign(Error('range'),{code:-32062});
  calls.push([fromBlock,toBlock]);return [fromBlock];
 }},{fromBlock:10,toBlock:1010});
 assert.deepEqual(calls,[[10,259],[260,509],[510,759],[760,1009],[1010,1010]]);
 assert.deepEqual(logs,[10,260,510,760,1010]);
 await assert.rejects(readFamilyLogWindow({fromBlock:1,anchorBlock:10,read:()=>{throw Error('canonical mismatch');}}),/canonical mismatch/);
});
test('legacy verification adapter aliases the active trust source and fallback requires a genesis pin',()=>{
 const a='https://primary.example/',b='https://backup.example/';
 assert.throws(()=>createFamilyRpcProviders(a,b,1),/genesis pin/);
 const pair=createFamilyRpcProviders(a,b,1,'0x'+'12'.repeat(32));
 assert.equal(pair.mode,'primary-fallback');
 assert.equal(canonicalFamilyProvider(pair.verificationProvider),pair.provider);
 pair.verificationProvider.destroy();pair.provider.destroy();
});

test('a rejected batch reports incompatibility without skipping individual read verification',async()=>{
 let rejected=0,requests=0;const primary=async x=>{requests++;if(Array.isArray(x))return x.map(r=>({id:r.id,error:{code:-32600,message:'batch not supported'}}));return result(x);};
 const response=await routeFamilyRpcPayload([p('eth_call'),p('eth_getCode',2)],primary,undefined,()=>rejected++);
 assert.equal(rejected,1);assert.equal(requests,3);assert.deepEqual(response,[{id:1,result:'ok'},{id:2,result:'ok'}]);
});
