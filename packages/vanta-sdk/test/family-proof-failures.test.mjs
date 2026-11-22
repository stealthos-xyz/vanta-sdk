import test from 'node:test';
import assert from 'node:assert/strict';
import {familyProofFailure,depositFailure,publicDepositFailure,readDepositFailure} from '../fresh/family-deposit-errors.mjs';

test('local proof stages preserve safe network errors and classify worker/runtime failures',()=>{
 const network=Error('Family network request: RPC public read on rpc.testnet.dogeos.com returned HTTP 503 after retry.');
 assert.equal(familyProofFailure(network,'spending proof'),network);
 for(const [message,code] of [['Vanta MSM worker rejected a chunk','LOCAL_PROOF_WORKER_FAILED'],['memory access out of bounds','LOCAL_PROOF_RUNTIME_FAILED'],['Vanta pinned browser artifact unavailable or invalid.','LOCAL_PROOF_ARTIFACT_UNAVAILABLE'],['Caulk+ public opening does not match signed KZG checkpoint','LOCAL_PROOF_INPUT_REJECTED']]){
  const error=familyProofFailure(message,'spending proof');assert.equal(error.code,code);
  const failure=publicDepositFailure(depositFailure(error,'Transfer preparation'));
  assert.match(readDepositFailure(failure).message,/spending proof/);assert.equal(failure.code,code);
 }
 const cancelled=new DOMException('Cancelled','AbortError');assert.equal(familyProofFailure(cancelled,'fee proof'),cancelled);
});

test('unknown local exceptions cannot expose secrets, raw RPC data or stacks',()=>{
 for(const step of ['fee proof','note openings','spending proof','payout proof']){
  const secret='password=never-publish witness={private-input} '+ '0x'+'ab'.repeat(64);
  for(const raw of [secret,Error(secret),Object.assign(Error(secret),{cause:{witness:secret},stack:secret})]){
   const failure=publicDepositFailure(depositFailure(familyProofFailure(raw,step),'Route preparation'));
   assert.equal(failure.code,'LOCAL_PROOF_FAILED');assert.ok(readDepositFailure(failure));
   assert.match(failure.cause,new RegExp(step));assert.doesNotMatch(JSON.stringify(failure),/never-publish|private-input|abab|stack/);
  }
 }
 assert.throws(()=>familyProofFailure(Error('secret'),'untrusted input'),/Invalid local proof stage/);
 const asset=depositFailure(Error('Family network request: SDK proof resource returned HTTP 503.'),'Wallet asset');
 assert.equal(publicDepositFailure(asset).stage,'Wallet asset');assert.doesNotMatch(asset.message,/could not be unlocked/);
});
