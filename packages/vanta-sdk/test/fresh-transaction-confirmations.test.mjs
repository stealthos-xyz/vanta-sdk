import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {getConfirmedBlock,getSharedConfirmedBlock,SDK_SETTLEMENT_POLICY} from '../fresh/transaction-confirmations.mjs';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const rpc=({head=100,change=false}={})=>({
  async getBlock(tag){
    assert.notEqual(tag,'finalized');assert.notEqual(tag,'safe');
    const number=tag==='latest'?head:tag;
    return {number,hash:hash(number+(change&&tag!=='latest'?1000:0)),
      parentHash:hash(number-1),timestamp:number*3};
  },
});
test('one additional block confirms a mined transaction without querying full finality',async()=>{
  const block=await getConfirmedBlock(rpc());
  assert.equal(block.number,99);assert.equal(block.hash,hash(99));
  assert.deepEqual(block.settlement,{mode:'confirmations',confirmations:2,consensusFinality:false});
  assert.ok(Object.isFrozen(SDK_SETTLEMENT_POLICY));
});
test('newly mined receipt is pending until its second confirmation',async()=>{
  assert.equal(100<=(await getConfirmedBlock(rpc({head:100}))).number,false);
  assert.equal(100<=(await getConfirmedBlock(rpc({head:101}))).number,true);
});
test('missing heads, wrong numeric blocks and reorgs fail reconciliation',async()=>{
  await assert.rejects(()=>getConfirmedBlock(rpc({head:1})),/unavailable/);
  await assert.rejects(()=>getConfirmedBlock(rpc({change:true})),/changed/);
  await assert.rejects(()=>getConfirmedBlock({getBlock:async()=>null}),/unavailable/);
  await assert.rejects(()=>getConfirmedBlock({getBlock:async tag=>({number:100,hash:hash(100)})}),/changed/);
});
test('provider lag uses the shared confirmed block and rejects divergent canonical histories',async()=>{
  const block=await getSharedConfirmedBlock(rpc(),rpc({head:98}));assert.equal(block.number,97);
  const other=rpc();other.getBlock=async tag=>({number:tag==='latest'?100:tag,hash:hash(1000+(tag==='latest'?100:tag))});
  await assert.rejects(()=>getSharedConfirmedBlock(rpc(),other),/disagree/);
});
test('every shipped SDK network wait uses confirmation policy, with no literal finalized/safe RPC waits',async()=>{
  const dir=new URL('../fresh/',import.meta.url);
  for(const name of await readdir(dir)){
    if(!name.endsWith('.mjs')||['wallet-runtime.mjs','recovery-core.mjs'].includes(name))continue;
    const source=await readFile(new URL(name,dir),'utf8');
    assert.doesNotMatch(source,/getBlock\(\s*['"](?:finalized|safe)['"]\s*\)|blockTag\s*:\s*['"](?:finalized|safe)['"]/u,name);
  }
});
