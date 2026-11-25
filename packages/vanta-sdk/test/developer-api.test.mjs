import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVantaError,normalizeVantaTransactionStatus,VANTA_ROUTE,VantaSdkError} from '../api/developer.mjs';
import {observePartnerClient,reconcilePartnerTransaction} from '../browser/partner-progress.mjs';
const h='0x'+'12'.repeat(32),h2='0x'+'34'.repeat(32);
const view=(operation,result,id='local-intent')=>normalizeVantaTransactionStatus({operation,id,result});
test('errors use a closed vocabulary and never copy raw upstream data',()=>{
 const e=normalizeVantaError({code:'USER_REJECTED',message:'private phrase',data:{seed:'private'}});
 assert.ok(e instanceof VantaSdkError);assert.equal(e.code,'USER_REJECTED');assert.equal(e.recovery,'reconcile');
 assert.ok(!e.message.includes('private'));assert.equal(e.data,undefined);
 assert.equal(normalizeVantaError({code:'UNEXPECTED_UPSTREAM',message:'secret'}).code,'UNKNOWN');
 assert.equal(normalizeVantaError({code:4001}).code,'USER_REJECTED');
 assert.equal(normalizeVantaError({code:'PASSWORD_REQUIRED'}).recovery,'reconnect');
 assert.equal(normalizeVantaError({code:'INVALID_REVIEW'}).recovery,'review-again');
});
test('ambiguous authorization errors never recommend resubmission',()=>{
 for(const code of ['USER_REJECTED','INSUFFICIENT_FUNDS','INVALID_REVIEW','SESSION_EXPIRED','UNKNOWN',undefined]){
  const e=normalizeVantaError({code},{submissionMayHaveStarted:true});
  assert.equal(e.code,'AUTHORIZATION_UNCERTAIN');assert.equal(e.recovery,'reconcile');
 }
 assert.equal(normalizeVantaError({code:'AUTHORIZATION_ALREADY_ATTEMPTED'},{submissionMayHaveStarted:true}).code,'AUTHORIZATION_ALREADY_ATTEMPTED');
});
test('normal transaction status uses journal identity and canonical receipt',()=>{
 const r=view('deposit',{preparedId:'local-intent',phase:'broadcast-uncertain',transactionHash:h});assert.equal(r.complete,false);
 assert.equal(view('private-send',{phase:'included',transactionHash:h}).complete,false);
 assert.equal(view('withdrawal',{phase:'finalized',transactionHash:h}).complete,true);
 assert.equal(view('withdrawal',{phase:'finalized',transactionHash:null}).phase,'unknown');
 assert.throws(()=>view('deposit',{preparedId:'different',phase:'finalized',transactionHash:h}),{code:'INVALID_STATUS'});
 assert.throws(()=>view('unsupported',{}),{code:'INVALID_STATUS'});
});
test('bridge source finality never implies destination delivery',()=>{
 const row={phase:'finalized',transactionHash:h};
 assert.equal(view('bridge',row).phase,'awaiting-delivery');
 assert.equal(view('bridge',{...row,delivery:{phase:'delivery-failed',transactionHash:h2}}).complete,false);
 assert.equal(view('bridge',{...row,delivery:{phase:'delivered-finalized',transactionHash:h2}}).complete,true);
 assert.equal(view('bridge',{...row,delivery:{phase:'delivered-finalized'}}).complete,false);
});
test('private swap output must be reconciled before completion',()=>{
 const row={privateOutput:true,phase:'finalized',transactionHash:h};
 assert.equal(view('swap',row).phase,'private-output-pending');
 assert.equal(view('swap',{...row,outputTransactionHash:h2}).complete,true);
 assert.equal(view('swap',{...row,phase:'private-output-pending',outputTransactionHash:h2}).complete,false);
});
test('enhanced withdrawals and public batches use their own completion evidence',()=>{
 const claims=[1,2,3].map(number=>({number,state:'finalized',transactionHash:h}));
 const status={authorized:true,authorizationFailed:false,recoveryRequired:false,total:3,completed:3,claims};
 assert.equal(view('enhanced-withdrawal',{status}).complete,true);
 assert.equal(view('enhanced-withdrawal',{status:{...status,completed:2}}).complete,false);
 assert.equal(view('enhanced-withdrawal',{status:{...status,recoveryRequired:true}}).phase,'recovery-required');
 assert.equal(view('enhanced-withdrawal',{status:{...status,claims:[...claims.slice(0,2),{...claims[2],transactionHash:null}]}}).complete,false);
 assert.equal(view('public-batch',{status:{authorized:true,finalized:true,authorizationFailed:false,transactionHash:h}}).complete,true);
 assert.equal(view('public-batch',{authorized:true,finalized:false,transactionHash:h}).complete,false);
});
test('one reconciliation entry point delegates without executing or authorizing',async()=>{
 const calls=[],client=Object.fromEntries(['reconcileDeposit','reconcilePrivateSend','monitorWithdrawal','monitorPublicBatch','reconcileRoute'].map(name=>[name,async args=>{calls.push([name,args]);return {phase:'included',transactionHash:h};}]));
 for(const operation of ['deposit','private-send','withdrawal','enhanced-withdrawal','public-batch','swap','bridge'])await reconcilePartnerTransaction(client,{operation,id:'local-intent',historyAsset:'native'});
 assert.deepEqual(calls.map(([name])=>name),['reconcileDeposit','reconcilePrivateSend','monitorWithdrawal','monitorWithdrawal','monitorPublicBatch','reconcileRoute','reconcileRoute']);
 assert.equal(calls[2][1].enhanced,false);assert.equal(calls[3][1].enhanced,true);
 assert.equal(calls[5][1].operation,VANTA_ROUTE.SWAP);assert.equal(calls[6][1].operation,VANTA_ROUTE.BRIDGE);
 assert.ok(calls.every(([,args])=>args.historyAsset==='native'));
 await assert.rejects(reconcilePartnerTransaction(client,{operation:'deposit',id:''}),{code:'INVALID_ARGUMENT'});assert.equal(calls.length,7);
});
test('progress is safe, coarse, non-authorizing and preserves promise identity',async()=>{
 const events=[],sent=Promise.resolve({phase:'prepared',private:'not for observer'});
 const client=observePartnerClient({prepareReviewedDeposit:()=>sent,executeDeposit:()=>Promise.reject(Object.assign(Error('sensitive'),{code:'TIMEOUT'}))},event=>{events.push(event);throw Error('observer unavailable');});
 assert.equal(client.prepareReviewedDeposit({quoteId:'not for observer'}),sent);await sent;
 await assert.rejects(client.executeDeposit({preparedId:'not for observer'}),/sensitive/);
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(events.map(({method,stage,state,code})=>[method,stage,state,code]),[
 ['prepareReviewedDeposit','preparing','started',undefined],['prepareReviewedDeposit','preparing','completed',undefined],
 ['executeDeposit','authorizing','started',undefined],['executeDeposit','authorizing','failed','AUTHORIZATION_UNCERTAIN']]);
 assert.ok(events.every(Object.isFrozen));assert.ok(!JSON.stringify(events).includes('not for observer'));
});
test('rejected asynchronous observers cannot change operation success',async()=>{
 const client=observePartnerClient({recoverNotes:async()=>({ok:true})},async()=>{throw Error('observer rejected');});
 assert.deepEqual(await client.recoverNotes(),{ok:true});await new Promise(resolve=>setTimeout(resolve,0));
});
