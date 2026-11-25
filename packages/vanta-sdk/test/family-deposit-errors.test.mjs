import test from 'node:test';import assert from 'node:assert/strict';import {id}from'ethers';
import {depositFailure,depositWalletSubmissionCode,publicDepositFailure,readDepositFailure,uncertainDepositSubmission}from'../fresh/family-deposit-errors.mjs';
test('funded operation diagnostics preserve the concrete transfer check without deposit labels',()=>{const e=depositFailure(Error('Private transfer: Fee signature differs from the deployed pool signer.'),'Withdrawal preparation');assert.equal(e.code,'TRANSACTION_FAILED');assert.match(readDepositFailure(publicDepositFailure(e)).message,/Fee signature differs/);assert.ok(!e.message.includes('DEPOSIT_FAILED'));});
test('deposit errors survive the worker boundary with their stage and actual contract reason',()=>{
 const e=depositFailure({code:'CALL_EXCEPTION',data:id('InvalidClearance()').slice(0,10),message:'private transaction payload'},'Contract simulation');
 const decoded=readDepositFailure(structuredClone(publicDepositFailure(e)));
 assert.match(decoded.message,/Contract simulation: Contract reverted: InvalidClearance/);assert.equal(decoded.code,'CALL_EXCEPTION');
});
test('RPC rate limits and insufficient funds retain their causes without transaction data',()=>{
 for(const [text,reason]of [['Request is being rate limited','RPC rate limit'],['insufficient funds for gas * price + value','insufficient funds']]){
  const e=depositFailure({code:'CALL_EXCEPTION',info:{error:{message:text}},transaction:{data:'private-transaction'}},'Contract simulation');assert.match(e.message,new RegExp(reason));assert.ok(!JSON.stringify(publicDepositFailure(e)).includes('private-transaction'));
 }
});
test('plain SDK deposit checks retain their precise reason; private payloads and forged details are not forwarded',()=>{
 assert.match(depositFailure(Error('SDK family release: contract code differs'),'Supported asset').message,/SDK family release: contract code differs/);
 assert.match(depositFailure(Error('Partner asset settings are unavailable.'),'Supported asset').message,/Partner asset settings are unavailable/);
 assert.equal(depositFailure(Error('Family deposit: deposit source moved; prepare again'),'Deposit intent').message,'Deposit intent: Family deposit: deposit source moved; prepare again');
 const privateError=depositFailure(Error('Family deposit: witness={privateSeed:"secret"}'),'Proof generation');assert.ok(!privateError.message.includes('privateSeed'));
 assert.equal(publicDepositFailure({depositFailure:{stage:'Proof generation',cause:'private'}}),undefined);
 assert.equal(readDepositFailure({stage:'Proof generation',code:'DEPOSIT_FAILED',cause:'witness=private'}),null);
});

import {createFamilyDepositJournal} from '../fresh/family-deposit-journal.mjs';
test('a definite insufficient-funds rejection survives the browser boundary without exposing RPC data',()=>{
 const rejected={code:-32603,data:{originalError:{code:-32000,message:'insufficient funds for gas * price + value: have 100 want 101'}}};
 assert.equal(depositWalletSubmissionCode(rejected),'INSUFFICIENT_FUNDS');
 assert.equal(depositWalletSubmissionCode({code:4001}),'USER_REJECTED');
 for(const error of [{code:-32000,message:'already known'},{code:-32000,message:'balance unavailable'},{code:'TIMEOUT'},{code:-32603,message:'insufficient funds'}])
  assert.equal(depositWalletSubmissionCode(error),undefined);
 const sanitized=depositFailure({code:depositWalletSubmissionCode(rejected)},'Wallet submission');
 assert.match(readDepositFailure(publicDepositFailure(sanitized)).message,/network fee/);
 assert.ok(!sanitized.message.includes('have 100'));
});
test('only an armed, hashless deposit can become a definitive wallet gas failure',async()=>{
 const identifier=n=>'0x'+n.toString(16).padStart(64,'0');
 let rows=[];
 const store={scope:'vanta-host-v1/wallet/doge/current',read:async()=>rows,transact:async(_namespace,update)=>{
  const {next,result}=update(rows);rows=next;return result;
 }};
 const journal=createFamilyDepositJournal({store,networkId:'doge',generationId:'current',pool:'pool'});
 const session={subjectId:'user',sessionId:'browser',maximumSessionDebitAtomic:'1000'};
 async function arm(n){
  const preparedId=identifier(n);
  await journal.reserve({preparedId,quoteNonce:identifier(n+100),session,amountAtomic:'100',deadline:Math.floor(Date.now()/1000)+600,plan:{}});
  await journal.recordInsufficientFunds(preparedId);
  assert.equal((await journal.read(preparedId)).phase,'prepared');
  await journal.arm(preparedId,session);
  return preparedId;
 }
 const first=await arm(1);
 await journal.recordInsufficientFunds(first);
 assert.equal((await journal.read(first)).phase,'failed');
 assert.equal((await journal.read(first)).failure,'insufficient-funds');
 const second=await arm(2);
 await journal.mark(second,'broadcast-uncertain',identifier(201));
 await journal.recordInsufficientFunds(second);
 assert.equal((await journal.read(second)).phase,'broadcast-uncertain');
 assert.equal((await journal.read(second)).transactionHash,identifier(201));
});

test('only definite wallet rejections become terminal; conflicting and ambiguous outcomes remain pending',()=>{
 const txHash='0x'+'a'.repeat(64);
 for(const e of [{code:4001},{code:-32603,data:{originalError:{code:4001}}},{code:'ACTION_REJECTED',reason:'rejected'}])
  assert.equal(depositWalletSubmissionCode(e),'USER_REJECTED');
 assert.equal(depositWalletSubmissionCode({code:'WALLET_SUBMISSION_REJECTED'}),'WALLET_SUBMISSION_REJECTED');
 for(const e of [{code:4001,transactionHash:txHash},{code:-32603,error:{code:4001},receipt:{hash:txHash}},{code:'TIMEOUT',message:'broadcast timed out',cause:{code:4001}},{code:4001,cause:{code:'INSUFFICIENT_FUNDS'}},{code:-32002},{code:4900},{code:-32602}])
  assert.equal(depositWalletSubmissionCode(e),undefined);
 const failure=depositFailure(uncertainDepositSubmission({code:'TIMEOUT',data:{private:'not forwarded'}}),'Wallet submission');
 assert.equal(failure.code,'AUTHORIZATION_UNCERTAIN');
 assert.match(readDepositFailure(publicDepositFailure(failure)).message,/timed out/);
 assert.ok(!failure.message.includes('not forwarded'));
 assert.match(depositFailure({code:'USER_REJECTED'},'Wallet submission').message,/cancelled/);
});
test('cancelled and pre-dispatch rejections settle only hashless armed journal rows',async()=>{
 const id=n=>'0x'+n.toString(16).padStart(64,'0');let rows=[];
 const store={scope:'vanta-host-v1/wallet/doge/current',read:async()=>rows,transact:async(_ns,update)=>{const out=update(rows);rows=out.next;return out.result;}};
 const journal=createFamilyDepositJournal({store,networkId:'doge',generationId:'current',pool:'pool'});
 const session={subjectId:'user',sessionId:'browser',maximumSessionDebitAtomic:'1000'};
 for(const [i,code,failure] of [[1,'USER_REJECTED','user-rejected'],[2,'WALLET_SUBMISSION_REJECTED','submission-rejected'],[3,'USER_REJECTED','user-rejected']]){
  const preparedId=id(i);
  await journal.reserve({preparedId,quoteNonce:id(100+i),session,amountAtomic:'100',deadline:Math.floor(Date.now()/1000)+600,plan:{}});
  await journal.recordRejection(preparedId,code);assert.equal((await journal.read(preparedId)).phase,'prepared');
  await journal.arm(preparedId,session);
  if(i===3)await journal.mark(preparedId,'broadcast-uncertain',id(303));
  await journal.recordRejection(preparedId,code);
  const row=await journal.read(preparedId);
  assert.equal(row.phase,i===3?'broadcast-uncertain':'failed');
  if(i!==3)assert.equal(row.failure,failure);else assert.equal(row.transactionHash,id(303));
 }
 await assert.rejects(journal.recordRejection(id(3),'AUTHORIZATION_UNCERTAIN'));
});
