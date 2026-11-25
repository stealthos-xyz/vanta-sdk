import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReview,toAtomic,positiveAtomic,reconcile,readHistory} from '../src/flows.mjs';
const destination='0x'+'1'.repeat(40);
const fresh=()=>({quoteId:'q',deadline:Date.now()/1000+120});
const mock=handlers=>{const calls=[];return {calls, client:Object.fromEntries(Object.entries(handlers).map(([name,handler])=>[name,async input=>{calls.push([name,input]);return typeof handler==='function'?handler(input):handler;}]))};};
test('exact atomic conversion and positive validation',()=>{assert.equal(toAtomic('1.25',6),'1250000');assert.throws(()=>toAtomic('1.001',2));assert.throws(()=>positiveAtomic('1.2'));assert.equal(positiveAtomic('1'),'1');});
for (const kind of ['deposit','payment','private','withdrawal','enhanced','batch','swap','bridge']) {
  test(kind+' quote and explicit single submission',async()=>{
    const enhanced=kind==='enhanced', op=kind==='swap'?4:5, q=fresh();
    const {client,calls}=mock({
      quoteDeposit:q,quotePayment:q,quotePrivateSend:q,quoteWithdrawal:{quoteId:'q',expiresAt:q.deadline},
      quotePublicBatch:{quoteId:'q',expiresAt:q.deadline},quoteRoute:{minimumOutputAtomic:'9',maximumDeliveryFeeAtomic:'1',outputDecimals:6},quoteRouteFees:q,
      prepareReviewedDeposit:{preparedId:'p'},executeDeposit:{preparedId:'p',transactionHash:'h'},reconcileDeposit:{phase:'finalized'},
      prepareReviewedPayment:{preparedId:'p'},executePayment:{preparedId:'p',transactionHash:'h'},reconcilePayment:{phase:'finalized'},
      prepareReviewedPrivateSend:{preparedId:'p'},executePrivateSend:{preparedId:'p'},reconcilePrivateSend:{phase:'finalized'},
      prepareReviewedWithdrawal:{intentId:'p',enhanced},authorizeWithdrawal:enhanced?{transactionId:'t',status:{completed:1}}:{preparedId:'p',phase:'included'},monitorWithdrawal:{phase:'included'},
      prepareReviewedPublicBatch:{intentId:'p'},authorizePublicBatch:{transactionId:'t'},monitorPublicBatch:{finalized:false},
      prepareReviewedRoute:{preparedId:'p'},executeRoute:{preparedId:'p'},reconcileRoute:{phase:'included'},
    });
    const r=await createReview(client,{kind,amountAtomic:'10',destination,partnerHandle:'test',recipient:{schema:'recipient'},payments:[{recipient:destination,amountAtomic:'10'}],slippageBps:100});
    assert.ok(calls.every(([name])=>name.startsWith('quote')));
    await assert.rejects(r.submit(false)); const result=await r.submit(true);assert.ok(result);
    await assert.rejects(r.submit(true));
    if(kind==='withdrawal'||kind==='enhanced') assert.deepEqual(calls.at(-1),['monitorWithdrawal',{transactionId:enhanced?'t':'p',enhanced}]);
    if(kind==='swap'||kind==='bridge') assert.equal(calls.at(-1)[1].operation,op);
  });
}
test('ambiguous submit is not replayed',async()=>{
  const {client,calls}=mock({quoteDeposit:fresh(),prepareReviewedDeposit:{preparedId:'p'},executeDeposit:()=>{throw Error('timeout');}});
  const r=await createReview(client,{kind:'deposit',amountAtomic:'1',partnerHandle:'x'});
  await assert.rejects(r.submit(true));await assert.rejects(r.submit(true));
  assert.equal(calls.filter(([n])=>n==='executeDeposit').length,1);
});
test('history and reconciliation preserve ID',async()=>{
  const {client,calls}=mock({listWithdrawals:[{enhanced:true},{enhanced:false,batch:true},{enhanced:false}],monitorWithdrawal:{completed:2}});
  assert.equal((await readHistory(client,'enhanced')).length,1);
  await reconcile(client,'enhanced','original');
  assert.deepEqual(calls.at(-1),['monitorWithdrawal',{transactionId:'original',enhanced:true}]);
});
