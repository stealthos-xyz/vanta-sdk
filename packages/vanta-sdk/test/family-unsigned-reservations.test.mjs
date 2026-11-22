import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileFamilyUnsignedReservations} from '../fresh/family-unsigned-reservations.mjs';
import {recoverFamilyBalanceSummary} from '../fresh/family-balance-projection.mjs';
import {createFamilySpendFence} from '../fresh/family-spend-fence.mjs';
import {setup,state,row,W} from './family-normal-host-fixture.mjs';

async function fixture(phase='prepared',operation=1) {
 const f=setup(operation),item={...row(),phase};
 await f.store.transact(f.namespace,()=>({next:[item],result:undefined}));
 const fence=createFamilySpendFence({store:f.store,pool:item.pool});
 await fence.reserve({id:item.id,nullifiers:item.nullifiers});
 const inventory={context:{pool:item.pool,asset:item.q.asset,generationId:item.generationId},complete:true,
  blockNumber:10,blockHash:state.blockHash,notes:item.nullifiers.map(nullifier=>({status:'spendable',nullifier,epoch:0,opening:{amount_units:'37783484354266294429'}})),
  epochs:[{epoch:0}],receivedTransactions:[],verifiedEmpty:false};
 const input={store:f.store,resource:state.resources,inventory,provider:f.options.provider,verificationProvider:f.options.verificationProvider};
 return {...f,item,fence,inventory,input};
}
test('DOGE-selected balance recovery releases an expired unsigned USDC attempt',async()=>{
 const f=await fixture();state.time=3000;
 const native={...state.resources,deployment:{...state.resources.deployment,pool:'0x'+'09'.repeat(20),asset:'0x'+'00'.repeat(20)}};
 const primary={...f.inventory,context:{...f.inventory.context,pool:native.deployment.pool,asset:native.deployment.asset},notes:[]};
 const result=await recoverFamilyBalanceSummary({primaryInventory:primary,resources:[native,state.resources],store:f.store,
  recover:async()=>f.inventory,reconcileUnsigned:args=>reconcileFamilyUnsignedReservations({...f.input,...args})});
 assert.equal(result.pools[1].unreservedBalanceUnits,'37783484354266294429');
 assert.equal((await f.fence.reservations()).length,0);
 assert.equal((await f.store.read(f.namespace))[0].phase,'expired-unused');
 assert.equal(state.submissions,0);
});
test('failed unsigned sends, withdrawals, swaps and bridges release before the quote expires',async()=>{
 for(const operation of [0,1,4,5]) {
  const f=await fixture('failed',operation);
  await reconcileFamilyUnsignedReservations(f.input);
  assert.equal((await f.fence.reservations()).length,0);
  assert.equal((await f.store.read(f.namespace))[0].phase,'failed');
  assert.equal(state.submissions,0);
 }
});
test('armed, uncertain, still-valid, spent, mismatched and reorged attempts keep their fences',async()=>{
 for(const variant of ['armed','submitting','valid','spent','nonce','wrong-pool','hash-only','reorg']) {
  const f=await fixture(variant==='submitting'?'submitting':'prepared');state.time=variant==='valid'?1000:3000;
  if(variant==='armed'){await f.fence.arm(f.item.id);state.time=1000;}
  if(variant==='spent')f.inventory.notes[0].status='spent';
  if(variant==='nonce')state.used=true;
  if(variant==='wrong-pool')await f.store.transact(f.namespace,rows=>({next:rows.map(r=>({...r,pool:'other'})),result:undefined}));
  if(variant==='hash-only')await f.store.transact(f.namespace,rows=>({next:rows.map(({calldata,...r})=>r),result:undefined}));
  if(variant==='reorg')f.inventory.blockHash=W(99);
  await reconcileFamilyUnsignedReservations(f.input);
  assert.equal((await f.fence.reservations()).length,1,variant);
 }
});
test('an expired armed review releases only after canonical unused nonce and unspent inputs',async()=>{
 const f=await fixture();await f.fence.arm(f.item.id);state.time=3000;
 await reconcileFamilyUnsignedReservations(f.input);
 assert.equal((await f.fence.reservations()).length,0);
 assert.equal((await f.store.read(f.namespace))[0].phase,'expired-unused');
});
test('proof failure without calldata releases immediately and an interrupted proof waits for expiry',async()=>{
 for(const phase of ['failed','proving']){
  const f=await fixture(phase);
  await f.store.transact(f.namespace,rows=>({next:rows.map(({calldata,calldataHash,...r})=>r),result:undefined}));
  await reconcileFamilyUnsignedReservations(f.input);
  assert.equal((await f.fence.reservations()).length,phase==='failed'?0:1);
  state.time=3000;await reconcileFamilyUnsignedReservations(f.input);
  assert.equal((await f.fence.reservations()).length,0);
 }
});
test('a tab arming the fence during nonce checks prevents release and journal changes',async()=>{
 const f=await fixture();state.time=3000;
 const call=f.input.provider.call;
 f.input.provider.call=async request=>{await f.fence.arm(f.item.id);return call(request);};
 await assert.rejects(reconcileFamilyUnsignedReservations(f.input),/reserved/);
 assert.equal((await f.fence.reservations())[0].armed,true);
 assert.equal((await f.store.read(f.namespace))[0].phase,'prepared');
});
