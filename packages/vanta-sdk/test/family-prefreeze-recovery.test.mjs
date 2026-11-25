/** Pre-freeze fault regressions. Synthetic event/transport fixtures, no chain writes or proof generation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256} from 'ethers';
import {recoverFamilyCanonicalNotes} from '../fresh/family-note-recovery.mjs';
import {recoverFamilyBalanceSummary} from '../fresh/family-balance-projection.mjs';
import {createFamilyBalanceCache} from '../fresh/family-balance-cache.mjs';
import {createFamilyRpcProviders,canonicalFamilyProvider} from '../fresh/family-rpc.mjs';
import {buildVantaFamilyEnhancedConsentMessage} from '../fresh/family-enhanced-consent.mjs';
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const addr=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const domain={schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:6281971,familyTag:'0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445',genesisHash:word(100),generationId:word(2),setupId:word(3),pool:addr(101),asset:addr(0),poolCodehash:keccak256('0x6000'),nativeGlueSha256:'11'.repeat(32),nativeWasmSha256:'22'.repeat(32)};
const abi=new Interface(['function releaseSetupId() view returns(bytes32)','function releaseGenerationId() view returns(bytes32)','function releaseFamilyTag() view returns(bytes32)','function releaseChainId() view returns(uint256)','function releaseGenesisHash() view returns(bytes32)','function asset() view returns(address)','function activeGeneration() view returns(uint64,uint64,uint256)','function sourceSnapshot(uint64) view returns(uint64,uint256,uint256,uint256,bool)','event CanonicalKzgRow(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment)','event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)']);
function fixture({head=11,eventBlock=4}={}){
 const envelope='0x01'+'00'.repeat(63),logs=[];
 for(const [name,args] of [['CanonicalKzgRow',[0,32,5]],['CanonicalEncryptedNote',[0,32,5,keccak256(envelope),envelope]]]){
  logs.push({...abi.encodeEventLog(abi.getEvent(name),args),address:domain.pool,blockNumber:eventBlock,blockHash:word(eventBlock+100),transactionHash:word(55),index:logs.length});
 }
 const values={releaseSetupId:[domain.setupId],releaseGenerationId:[domain.generationId],releaseFamilyTag:[domain.familyTag],releaseChainId:[domain.chainId],releaseGenesisHash:[domain.genesisHash],asset:[domain.asset],activeGeneration:[0,33,19],sourceSnapshot:[33,12,13,19,false]};
 const make=()=>({getNetwork:async()=>({chainId:6281971n}),getCode:async()=>'0x6000',getBlock:async n=>{let h=n==='latest'?head:n;return {number:h,hash:word(h+100),parentHash:word(h+99)};},call:async r=>{const n=abi.parseTransaction(r).name;return abi.encodeFunctionResult(n,values[n]);},getLogs:async f=>{assert.deepEqual(Object.keys(f).sort(),['address','fromBlock','toBlock','topics']);assert.equal(f.topics.length,1);return structuredClone(logs.filter(l=>l.blockNumber>=f.fromBlock&&l.blockNumber<=f.toBlock));}});
 const primary=make(),secondary=make(),wallet={},delivery={context:domain,walletRecipient:async()=>({}),decrypt:async({commitment})=>({note:{commitment,amount_units:'17'},verification:{commitment,nullifier:word(7),nonspendable:false}})};
 const run=(verificationProvider,options={})=>recoverFamilyCanonicalNotes({provider:primary,verificationProvider,delivery,wallet,deploymentBlock:0,...options});
 return {primary,secondary,run};
}
for(const [name,mutate] of [
 ['secondary unavailable',s=>s.getNetwork=async()=>{throw Error('unavailable');}],
 ['contradictory block',s=>s.getBlock=async n=>{let h=n==='latest'?11:n;return {number:h,hash:word(h===10?999:h+100)};}],
 ['wrong genesis',s=>s.getBlock=async n=>{let h=n==='latest'?11:n;return {number:h,hash:word(h===0?999:h+100)};}],
 ['different runtime code',s=>s.getCode=async()=>'0x6001'],
 ['different policy read',s=>s.call=async()=>abi.encodeFunctionResult('releaseChainId',[1])],
 ['missing canonical event',s=>s.getLogs=async()=>[]],
]){
 test(name+' fails closed; healthy retry recovers the same synthetic note',async()=>{
  const {secondary,run}=fixture(),original={...secondary};mutate(secondary);
  await assert.rejects(()=>run(secondary));Object.assign(secondary,original);
  const actual=await run(secondary);assert.equal(actual.balanceAtomicAtAnchor,'17');
  assert.deepEqual(actual.receivedTransactions,[{transactionHash:word(55),blockNumber:4,amountAtomic:'17'}]);
 });
}
test('a lagging but consistent independent provider selects the shared confirmed anchor',async()=>{
 const {secondary,run}=fixture();
 secondary.getBlock=async n=>{const h=n==='latest'?8:n;return {number:h,hash:word(h+100),parentHash:word(h+99)};};
 const result=await run(secondary);assert.equal(result.blockNumber,7);assert.equal(result.balanceAtomicAtAnchor,'17');
});
test('identical HTTPS endpoints are not independent SDK providers',()=>{
 const result=createFamilyRpcProviders('https://rpc.example.invalid','https://rpc.example.invalid/',6281971);
 try{assert.equal(result.mode,'single-endpoint');assert.equal(canonicalFamilyProvider(result.verificationProvider),result.provider);}
 finally{result.verificationProvider.destroy();result.provider.destroy();}
});
test('new selected-asset receipt survives unrelated history outage then complete refresh',async()=>{
 const generationId=word(2),blockHash=word(1001),poolA=addr(201),poolB=addr(202),assetA=addr(301),assetB=addr(302);
 const resources=[{generationId,deployment:{pool:poolA,asset:assetA,assetSymbol:'A',assetDecimals:18}},{generationId,deployment:{pool:poolB,asset:assetB,assetSymbol:'B',assetDecimals:6}}];
 const receipt={transactionHash:word(111),blockNumber:42,amountAtomic:'19'};
 const inv=(i,amount,receivedTransactions)=>({context:{generationId,pool:resources[i].deployment.pool,asset:resources[i].deployment.asset},complete:true,blockNumber:42,blockHash,epochs:[{epoch:0}],notes:[{status:'spendable',nullifier:word(i+10),epoch:0,opening:{amount_units:amount}}],receivedTransactions,verifiedEmpty:false});
 const store={read:async()=>[],transact:async()=>{writes++;}},primary=inv(0,'19',[receipt]),secondary=inv(1,'25',[]);
 let writes=0;
 const cache=createFamilyBalanceCache({store,identity:'synthetic',generationId,pools:resources.map(r=>r.deployment)});
 const partial=await recoverFamilyBalanceSummary({primaryInventory:primary,resources,store,recover:async()=>{throw Error('other asset unavailable');}});
 assert.equal(partial.complete,false);assert.deepEqual(partial.receivedTransactions,[{...receipt,pool:poolA}]);
 await cache.saveSnapshot(partial);assert.equal(writes,0);
 const full=await recoverFamilyBalanceSummary({primaryInventory:primary,resources,store,recover:async()=>secondary});
 assert.equal(full.complete,true);assert.deepEqual(full.receivedTransactions,[{...receipt,pool:poolA}]);
 assert.deepEqual(full.pools.map(p=>p.spendableBalanceUnits),['19','25']);
 await cache.saveSnapshot(full);assert.equal(writes,1);
});
test('enhanced consent is bound to exact calldata, pool, asset and approved intent',()=>{
 const release={schema:'stealthos-family-sdk-release-v2',setup:{family:{id:'dogeos',tag:domain.familyTag}},pins:{networkId:'eip155:6281971',genesisHash:domain.genesisHash,generationId:domain.generationId},activation:{network:{id:'eip155:6281971',genesisHash:domain.genesisHash},familyTag:domain.familyTag},lock:{familyTag:domain.familyTag,contracts:[{kind:'pool',address:domain.pool}]}};
 const context={networkId:release.pins.networkId,generationId:domain.generationId,pool:domain.pool,assetAddress:domain.asset};
 const request={asset:domain.asset,calldata:'0x1234',intentId:'approved-intent',pool:domain.pool,requestId:'request-0001'};
 const m=buildVantaFamilyEnhancedConsentMessage(release,context,request,request.intentId);
 assert.notEqual(buildVantaFamilyEnhancedConsentMessage(release,context,{...request,calldata:'0x1235'},request.intentId),m);
 for(const change of [{intentId:'different-intent'},{asset:addr(9)},{pool:addr(8)}])assert.throws(()=>buildVantaFamilyEnhancedConsentMessage(release,context,{...request,...change},request.intentId));
});

test('canonical recovery uses an inclusive 1000-block default on both RPCs',async()=>{
 const {primary,secondary,run}=fixture({head:2001,eventBlock:999}),calls=[[],[]];
 for(const [index,source] of [primary,secondary].entries()){
  const original=source.getLogs;
  source.getLogs=async filter=>{calls[index].push([filter.fromBlock,filter.toBlock]);assert.ok(filter.toBlock-filter.fromBlock+1<=1000);return original(filter);};
 }
 const result=await run(secondary);
 assert.deepEqual(calls[0],[[0,999],[1000,1999],[2000,2000]]);
 assert.deepEqual(calls[1],calls[0]);assert.equal(result.balanceAtomicAtAnchor,'17');
});
for(const limited of ['primary','secondary']){
 test(limited+' range rejection retries both sources without skipping blocks',async()=>{
  const f=fixture({head:1201,eventBlock:500}),accepted=[[],[]],attempted=[];
  for(const [index,source] of [f.primary,f.secondary].entries()){
   const original=source.getLogs;
   source.getLogs=async filter=>{
    const range=[filter.fromBlock,filter.toBlock];
    if(source===f[limited]&&range[1]-range[0]+1>500){
     attempted.push(range);throw Object.assign(Error('could not coalesce error'),{code:'UNKNOWN_ERROR',info:{error:{code:-32062,message:'Block range is too large'}}});
    }
    accepted[index].push(range);return original(filter);
   };
  }
  const result=await f.run(f.secondary);
  const expected=[[0,499],[500,999],[1000,1200]];
  assert.deepEqual(attempted,[[0,999]]);
  assert.deepEqual(accepted[0],limited==='secondary'?[[0,999],...expected]:expected);
  assert.deepEqual(accepted[1],expected);
  assert.equal(result.balanceAtomicAtAnchor,'17');assert.equal(result.publicRows,1);
  assert.deepEqual(result.receivedTransactions,[{transactionHash:word(55),blockNumber:500,amountAtomic:'17'}]);
 });
}
test('range adaptation never suppresses a canonical disagreement',async()=>{
 const {secondary,run}=fixture({head:1201,eventBlock:500}),original=secondary.getLogs;
 secondary.getLogs=async filter=>{
  if(filter.toBlock-filter.fromBlock+1>500)throw Object.assign(Error('Block range is too large'),{code:-32062});
  return (await original(filter)).slice(0,0);
 };
 await assert.rejects(()=>run(secondary));
});
test('a non-range RPC error and a rejected single-block window fail closed',async()=>{
 for(const [error,chunkBlocks] of [[Error('RPC unavailable'),1000],[Object.assign(Error('Block range is too large'),{code:-32062}),1]]){
  const {secondary,run}=fixture();let calls=0;
  secondary.getLogs=async()=>{calls++;throw error;};
  await assert.rejects(()=>run(secondary,{chunkBlocks}),err=>err===error);
  assert.equal(calls,1);
 }
});

test('wallet fallback aliases the primary trust source and bounds batching',()=>{
 const result=createFamilyRpcProviders('https://rpc.example.invalid','https://verify.example.invalid',6281971,domain.genesisHash);
 try{
  assert.equal(result.mode,'primary-fallback');
  assert.equal(canonicalFamilyProvider(result.verificationProvider),result.provider);
  assert.equal(result.provider._getOption('batchMaxCount'),8);
  assert.equal(result.provider._getOption('cacheTimeout'),-1);
 }finally{result.verificationProvider.destroy();result.provider.destroy();}
});
test('interrupted verified display scan resumes from saved public windows without rescanning them',async()=>{
 const f=fixture({head:10001,eventBlock:999});let checkpoint=null;
 const cache={readCheckpoint:async()=>checkpoint,saveCheckpoint:async(_pool,record)=>{checkpoint=structuredClone(record);}};
 const original=f.secondary.getLogs;
 f.secondary.getLogs=async filter=>{if(filter.fromBlock>=8000)throw Error('RPC interrupted');return original(filter);};
 await assert.rejects(()=>f.run(f.secondary,{displayCache:cache,useSharedHistory:false}),/RPC interrupted/);
 assert.equal(checkpoint.anchor.number,7999);assert.equal(checkpoint.encryptedRows.length,1);
 const resumed=[];f.secondary.getLogs=async filter=>{resumed.push(filter.fromBlock);return original(filter);};
 const result=await f.run(f.secondary,{displayCache:cache,useSharedHistory:false});
 assert.equal(result.resumedDisplayCheckpoint,true);assert.equal(result.balanceAtomicAtAnchor,'17');
 assert.equal(resumed[0],8000);assert.equal(checkpoint.anchor.number,10000);
 resumed.length=0;await f.run(f.secondary);assert.equal(resumed[0],0);
});
test('a replaced local fork checkpoint may move backwards but a newer unrelated checkpoint is retained',async()=>{
 const generationId=word(2),pool=addr(201),state=new Map();
 const store={read:async name=>state.get(name)??[],transact:async(name,update)=>{const result=update(state.get(name)??[]);state.set(name,result.next);return result.result;}};
 const cache=createFamilyBalanceCache({store,identity:'public-checkpoint-fixture',generationId,pools:[{pool}]});
 const stale={anchor:{number:20,hash:word(20)}},fresh={anchor:{number:18,hash:word(18)}};
 await cache.saveCheckpoint(pool,stale);
 await cache.saveCheckpoint(pool,fresh);assert.deepEqual(await cache.readCheckpoint(pool),stale);
 await cache.saveCheckpoint(pool,fresh,stale.anchor);assert.deepEqual(await cache.readCheckpoint(pool),fresh);
 await cache.saveCheckpoint(pool,{anchor:{number:16,hash:word(16)}},stale.anchor);
 assert.deepEqual(await cache.readCheckpoint(pool),fresh);
});

test('review recovery reuses the verified display cursor; funded inventory still scans independently',async()=>{
 const f=fixture({head:2001,eventBlock:999});
 let checkpoint=null;
 const cache={readCheckpoint:async()=>checkpoint,saveCheckpoint:async(_pool,record)=>{checkpoint=structuredClone(record);}};
 // Start with a durable display cursor as if a previous process saved it.
 // A second independent pair represents a newly opened wallet worker.
 await f.run(f.secondary,{displayCache:cache,useSharedHistory:false});
 const fresh=fixture({head:2001,eventBlock:999}),scans=[];
 const original=fresh.secondary.getLogs;
 fresh.secondary.getLogs=async filter=>{scans.push(filter.fromBlock);return original(filter);};
 const review=await fresh.run(fresh.secondary,{displayCache:cache,useSharedHistory:false});
 assert.equal(review.resumedDisplayCheckpoint,true);assert.equal(review.balanceAtomicAtAnchor,'17');
 assert.deepEqual(scans,[]);
 const funded=await fresh.run(fresh.secondary);
 assert.equal(funded.resumedDisplayCheckpoint,undefined);assert.equal(funded.balanceAtomicAtAnchor,'17');
 assert.deepEqual(scans,[0,1000,2000]);
});
