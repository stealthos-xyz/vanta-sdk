import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256} from 'ethers';
import {verifyPublicPaymentReceipt,reconcileFamilyDepositReceipt} from '../fresh/family-public-payment-receipt.mjs';
const hash=n=>'0x'+n.toString(16).padStart(64,'0'),address=n=>'0x'+n.toString(16).padStart(40,'0');
const abi=new Interface(['event CanonicalKzgRow(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment)','event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)']);
function fixture(){
 const record={transaction:{chainId:6281971,from:address(1),to:address(2),data:'0x1234',value:'9'},preparedAtBlock:10,plan:{quote:{epoch:1},rowStart:4,outputs:['101','102','103'],encryptedOutputs:['0x11','0x22','0x33']}};
 const tx={...record.transaction,hash:hash(8)},receipt={status:1,blockNumber:10,blockHash:hash(10),logs:[]};
 for(let i=0;i<3;i++)for(const [name,args]of [['CanonicalKzgRow',[1,4+i,101+i]],['CanonicalEncryptedNote',[1,4+i,101+i,keccak256(record.plan.encryptedOutputs[i]),record.plan.encryptedOutputs[i]]]]){
  const event=abi.encodeEventLog(abi.getEvent(name),args);receipt.logs.push({...event,address:address(2),transactionHash:hash(8)});
 }
 const provider={getBlock:async n=>({number:n==='latest'?12:n,hash:hash(n==='latest'?12:n),parentHash:hash(n==='latest'?11:n-1),timestamp:1000}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,getLogs:async()=>receipt.logs.filter(l=>l.topics[0]===abi.getEvent('CanonicalEncryptedNote').topicHash)};
 return {record,tx,receipt,provider};
}
test('a public payer confirms recipient and both fee notes without a private wallet',async()=>{const f=fixture();const r=await verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider},transactionHash:hash(8)});assert.equal(r.phase,'finalized');assert.equal(r.transactionHash,hash(8));});
test('a missing wallet response is recovered by canonical events, never by resubmission',async()=>{const f=fixture();const r=await verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider}});assert.equal(r.phase,'finalized');});

test('a public deposit receipt rejects an unrelated execution transaction even if the note logs match',async()=>{
 const f=fixture();
 f.record.executionTransaction={chainId:6281971,from:address(7),to:address(8),data:'0xabcdef',value:'0'};
 Object.assign(f.tx,f.record.executionTransaction);
 await assert.rejects(verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider}}),/canonical transaction/);
 Object.assign(f.tx,f.record.transaction);
 const result=await verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider}});
 assert.equal(result.phase,'finalized');
});
test('exact sender, pool, chain, amount and calldata are mandatory',async()=>{
 for(const [key,value]of Object.entries({from:address(9),to:address(9),chainId:1,value:'8',data:'0xabcd',hash:hash(9)})){
  const f=fixture();f.tx[key]=value;await assert.rejects(verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider},transactionHash:hash(8)}),/canonical transaction/);
 }
});
test('missing, replaced, removed or duplicated recipient/fee outputs cannot confirm',async()=>{
 for(const mutation of [r=>r.logs.pop(),r=>r.logs.push(r.logs[0]),r=>r.logs[1].removed=true,r=>r.logs[1].data='0x',r=>r.logs[1].address=address(9)]){
  const f=fixture();mutation(f.receipt);await assert.rejects(verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider},transactionHash:hash(8)}));
 }
});
test('unconfirmed, missing, failed, disagreeing or reorganized receipts stay safe',async()=>{
 let f=fixture();f.receipt.blockNumber=12;assert.equal((await verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider},transactionHash:hash(8)})).phase,'pending');
 f=fixture();assert.equal((await verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider,getTransactionReceipt:async()=>null},transactionHash:hash(8)})).phase,'pending');
 f=fixture();f.receipt.status=0;assert.equal((await verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider},transactionHash:hash(8)})).phase,'failed');
 f=fixture();await assert.rejects(verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider,getTransactionReceipt:async()=>({...f.receipt,status:0})},transactionHash:hash(8)}));
 f=fixture();f.receipt.blockHash=hash(99);await assert.rejects(verifyPublicPaymentReceipt({...f,verificationProvider:{...f.provider},transactionHash:hash(8)}));
});

test('unused deposit authorizations expire without historical log reads',async()=>{
 for(const [deadline,phase]of [[999,'expired-unused'],[1000,'pending'],[1001,'pending']]){
  const f=fixture();f.record.deadline=deadline;
  let reads=0,checks=0;
  const provider={...f.provider,getLogs:async()=>{throw Error('historical scan is forbidden');},getTransaction:async()=>{throw Error('hashless transaction lookup is forbidden');}};
  const result=await reconcileFamilyDepositReceipt({...f,provider,verificationProvider:{...provider},validateAnchor:async()=>{checks++;},readUsedNonce:async anchor=>{reads++;assert.equal(anchor.number,11);return false;}});
  assert.equal(result.phase,phase);assert.equal(reads,1);assert.equal(checks,2);
 }
});
test('consumed deposit authorization recovers only its exact prepared transaction from both RPCs',async()=>{
 const f=fixture();f.record.deadline=999;let ranges=[];
 const provider={...f.provider,getLogs:async filter=>{ranges.push(filter);return f.provider.getLogs(filter);}};
 const result=await reconcileFamilyDepositReceipt({...f,provider,verificationProvider:{...provider},validateAnchor:async()=>{},readUsedNonce:async()=>true});
 assert.equal(result.phase,'finalized');assert.equal(result.transactionHash,hash(8));
 assert.equal(ranges.length,2);assert.ok(ranges.every(r=>r.fromBlock===10&&r.toBlock===11&&r.topics.length===1));
});
test('consumed nonce with absent or inconsistent exact receipts cannot expire or confirm',async()=>{
 const f=fixture();f.record.deadline=999;
 const base={...f,validateAnchor:async()=>{},readUsedNonce:async()=>true};
 await assert.rejects(reconcileFamilyDepositReceipt({...base,verificationProvider:{...f.provider,getLogs:async()=>[]}}));
 const provider={...f.provider,getLogs:async()=>[]};
 await assert.rejects(reconcileFamilyDepositReceipt({...base,provider,verificationProvider:{...provider}}));
 await assert.rejects(reconcileFamilyDepositReceipt({...base,verificationProvider:{...f.provider},readUsedNonce:async()=>{throw Error('independent nonce disagreement');}}),/independent nonce disagreement/);
});
test('a known reverted receipt is terminal without discovery; missing receipt stays pending until expiry',async()=>{
 const f=fixture();f.record.deadline=1001;f.record.transactionHash=hash(8);f.receipt.status=0;
 const provider={...f.provider,getLogs:async()=>{throw Error('unexpected log scan');}};
 const base={...f,provider,verificationProvider:{...provider},validateAnchor:async()=>{},readUsedNonce:async()=>false};
 assert.equal((await reconcileFamilyDepositReceipt(base)).phase,'failed');
 const missing={...provider,getTransactionReceipt:async()=>null};
 assert.equal((await reconcileFamilyDepositReceipt({...base,provider:missing,verificationProvider:{...missing}})).phase,'pending');
});
