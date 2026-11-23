import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverFamilyBalanceSummary} from '../fresh/family-balance-projection.mjs';
import {createFamilyBalanceCache} from '../fresh/family-balance-cache.mjs';

const hash='0x'+'11'.repeat(32),generationId='generation',bnmPool='0x'+'22'.repeat(20),usdcPool='0x'+'33'.repeat(20),
  bnmAsset='0x'+'44'.repeat(20),usdcAsset='0x'+'55'.repeat(20);
const resources=[{generationId,deployment:{pool:bnmPool,asset:bnmAsset,assetSymbol:'CCIP-BnM',assetDecimals:18}},
  {generationId,deployment:{pool:usdcPool,asset:usdcAsset,assetSymbol:'USDC',assetDecimals:6}}];
const inventory=(r,amount)=>({context:{generationId,pool:r.deployment.pool,asset:r.deployment.asset},complete:true,
  blockNumber:42,blockHash:hash,epochs:[{epoch:0}],notes:amount?[{status:'spendable',nullifier:'0x'+'66'.repeat(32),epoch:0,opening:{amount_units:String(amount)}}]:[],
  receivedTransactions:[],verifiedEmpty:!amount});
const primary=inventory(resources[0],100),secondary=inventory(resources[1],25);
const store=(failurePool)=>({read:async namespace=>{if(failurePool&&namespace.includes(failurePool))throw Error('synthetic store outage');return[]},
  transact:async()=>{throw Error('Unexpected cache write')}});
const run=(recover,localStore=store())=>recoverFamilyBalanceSummary({primaryInventory:primary,resources,store:localStore,recover});

test('unrelated USDC RPC failure retains canonical funded BnM, marks USDC unavailable, and does not cache an incomplete snapshot',async()=>{
 const summary=await run(async()=>{throw Error('synthetic unrelated RPC outage')});
 assert.equal(summary.complete,false);assert.equal(summary.blockNumber,42);assert.equal(summary.blockHash,hash);
 assert.equal(summary.pools.length,1);assert.equal(summary.pools[0].pool,bnmPool);assert.equal(summary.pools[0].spendableBalanceUnits,'100');
 assert.equal(summary.unavailablePools.length,1);assert.deepEqual(summary.unavailablePools[0],
  {pool:usdcPool,asset:usdcAsset,assetSymbol:'USDC',reason:'history-unavailable'});
 assert.equal(summary.receivedTransactions.length,0);
 let writes=0;const cache=createFamilyBalanceCache({store:{read:async()=>[],transact:async()=>{writes++}},identity:'synthetic',generationId,
  pools:resources.map(x=>x.deployment)});
 await cache.saveSnapshot(summary);assert.equal(writes,0);
});

test('a local USDC journal failure does not hide a canonical BnM balance',async()=>{
 const summary=await run(async()=>secondary,store(usdcPool));
 assert.equal(summary.complete,false);assert.equal(summary.pools.length,1);assert.equal(summary.pools[0].spendableBalanceUnits,'100');
 assert.equal(summary.unavailablePools[0].reason,'local-history-unavailable');
});

test('a mismatched secondary generation or anchor fails closed rather than joining inventories',async()=>{
 await assert.rejects(run(async()=>({...secondary,blockHash:'0x'+'99'.repeat(32)})),/signed pools and a canonical confirmed block/);
 await assert.rejects(run(async()=>({...secondary,context:{...secondary.context,generationId:'other'}})),/signed pools and a canonical confirmed block/);
});

test('fully recovered pools retain complete status and exact per-pool balances',async()=>{
 const summary=await run(async()=>secondary);
 assert.equal(summary.complete,true);assert.deepEqual(summary.unavailablePools,[]);
 assert.deepEqual(summary.pools.map(x=>x.spendableBalanceUnits),['100','25']);
});
