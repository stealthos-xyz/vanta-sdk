import test from 'node:test';import assert from 'node:assert/strict';
import{familyBalanceProjection as project}from'../fresh/family-balance-projection.mjs';
const pool='pool',generationId='generation',notes=[{status:'spendable',nullifier:'a',opening:{amount_units:'20000000'}}],fence={id:'send1',armed:true,nullifiers:['a']},row={id:'send1',pool,generationId,nullifiers:['a'],review:{totalDebitAtomic:'15000000'}};
const run=(extra={})=>project({notes,reservations:[fence],journals:[row],pool,generationId,...extra});
test('20 USDC input and 15 USDC total debit displays 5 USDC locked change',()=>assert.deepEqual(run(),{projectedBalanceUnits:'5000000',pendingChangeBalanceUnits:'5000000'}));
test('failure with canonically released fence restores full 20; confirmation shows actual 5 only',()=>{assert.deepEqual(run({reservations:[]}),{projectedBalanceUnits:'20000000',pendingChangeBalanceUnits:'0'});assert.deepEqual(run({notes:[{status:'spent',nullifier:'a',opening:{amount_units:'20000000'}},{status:'spendable',nullifier:'b',opening:{amount_units:'5000000'}}],reservations:[]}),{projectedBalanceUnits:'5000000',pendingChangeBalanceUnits:'0'});});
test('unconfirmed deposits never contribute and unrelated unreserved funds stay available',()=>assert.deepEqual(run({notes:[...notes,{status:'pending',nullifier:'p',opening:{amount_units:'100000000'}},{status:'spendable',nullifier:'b',opening:{amount_units:'2000000'}}]}),{projectedBalanceUnits:'7000000',pendingChangeBalanceUnits:'5000000'}));
test('unknown, duplicate, mismatched and partially spent journals cannot invent change',()=>{for(const journals of[[],[row,row],[{...row,pool:'other'}],[{...row,generationId:'other'}],[{...row,nullifiers:['b']}],[{...row,review:{totalDebitAtomic:'21000000'}}]])assert.equal(run({journals}).projectedBalanceUnits,'0');assert.equal(run({notes:[{...notes[0],status:'spent'}]}).projectedBalanceUnits,'0');});
test('normal, private, swap, bridge and enhanced preparations share display semantics',()=>{for(const operation of[0,1,4,5])assert.equal(run({journals:[{...row,q:{mode:operation}}]}).projectedBalanceUnits,'5000000');assert.equal(run({journals:[{intentId:'send1',nullifiers:['a'],plan:{domain:{pool,generationId},review:row.review}}]}).projectedBalanceUnits,'5000000');});

test('a cached balance is isolated to the unlocked private identity and carries no spend authority',async()=>{
 const {createFamilyBalanceCache}=await import('../fresh/family-balance-cache.mjs');
 const journal=new Map(),store={async read(key){return journal.get(key)??[];},
   async transact(key,apply){const {next}=apply(journal.get(key)??[]);journal.set(key,structuredClone(next));}};
 const options={store,generationId,pools:[{pool,asset:'asset',assetDecimals:6}]};
 const owner=createFamilyBalanceCache({...options,identity:'one'});
 assert.equal(await owner.readSnapshot(),null);
 const summary={generationId,blockNumber:100,blockHash:'0x'+'11'.repeat(32),pools:[{
  pool,assetDecimals:6,availableBalanceUnits:'200',projectedBalanceUnits:'5000000',
 }]};
 await owner.saveSnapshot(summary);
 assert.deepEqual(await owner.readSnapshot(),{generationId,blockNumber:100,blockHash:summary.blockHash,
  pools:[{pool,asset:'asset',assetDecimals:6,displayBalanceUnits:'5000000'}]});
 await owner.saveSnapshot({...summary,blockNumber:99,pools:[{pool,assetDecimals:6,projectedBalanceUnits:'0'}]});
 assert.equal((await owner.readSnapshot()).blockNumber,100);
 assert.equal(await createFamilyBalanceCache({...options,identity:'two'}).readSnapshot(),null);
 assert.equal(await createFamilyBalanceCache({...options,identity:'one',generationId:'other'}).readSnapshot(),null);
});
