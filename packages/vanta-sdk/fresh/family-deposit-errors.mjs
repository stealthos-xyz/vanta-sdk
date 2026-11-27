/** Public deposit failures. Never transport an ethers transaction, witness,
 * recovery material, raw RPC payload or stack across the wallet boundary. */
import {id} from 'ethers';
const known=new WeakSet();
export const DEPOSIT_STAGES=Object.freeze(['Wallet asset','Private balance recovery','Handle claim','Handle submission','Handle status','Handle recovery','Handle availability','Batch fee review','Batch preparation','Batch submission','Transfer fee review','Transfer preparation','Route fee review','Route preparation','Withdrawal fee review','Withdrawal preparation','Transaction authorization','Wallet session','Supported asset','Pool bindings','Receiving routes','Partner fee policy','Private note encryption','Native wallet screening','Deposit intent','Proof generation','Append keys','Recovery verification','Contract simulation','Pending deposit journal','Deposit approval','Wallet submission','Deposit status']);
const errors=new Map(['UnapprovedPreAuditSetup','InvalidQuote','InvalidSignature','FeeAuthorizationRequired','InvalidEncryptedNote','InvalidRow','InvalidProof','InvalidSource','Replay','InsufficientEscrow','AssetTransferMismatch','ReentrantCall','DepositCapacityReached','InvalidClearance','Unauthorized'].map(n=>[id(n+'()').slice(0,10),n]));
const safe=text=>typeof text==='string'&&text.length<=300&&!/[{}\r\n]|0x[0-9a-f]{32,}|(?:password|mnemonic|recovery phrase|seed|witness)\s*[:=]/iu.test(text);
/** Classify local preparation failures without transporting Rust exceptions,
 * private inputs, stack traces or arbitrary worker/upstream messages. */
export function familyProofFailure(error,step){
 if(!['fee proof','note openings','spending proof','payout proof'].includes(step))throw Error('Invalid local proof stage.');
 if(error?.name==='AbortError')return error;
 const message=typeof error==='string'?error:error?.message;
 if(safe(message)&&/^(?:Family |Private transfer|SDK family release:)/u.test(message))return typeof error==='string'?Error(error):error;
 let code='LOCAL_PROOF_FAILED',reason='The local proof operation failed.';
 if(message==='Vanta worker memory exhausted'){code='LOCAL_PROOF_RUNTIME_FAILED';reason='The browser could not allocate memory for a local proof worker.';}
 else if(message==='Vanta worker bootstrap failed'){code='LOCAL_PROOF_WORKER_FAILED';reason='A local proof worker could not initialize its pinned runtime.';}
 else if(message==='Vanta MSM worker response timed out'){code='LOCAL_PROOF_WORKER_FAILED';reason='A local proof worker timed out.';}
 else if(/memory|allocation|out of bounds|unreachable/iu.test(String(message))){code='LOCAL_PROOF_RUNTIME_FAILED';reason='The local proof runtime stopped.';}
 else if(/^Vanta MSM worker /u.test(String(message))){code='LOCAL_PROOF_WORKER_FAILED';reason='A local proof worker stopped or rejected its work.';}
 else if(/^Vanta (?:pinned browser artifact|browser artifact SHA-256|combined BOUND4 .*hash mismatch|Gate0 BOUND4 .*hash mismatch)/u.test(String(message))){code='LOCAL_PROOF_ARTIFACT_UNAVAILABLE';reason='A pinned public proof resource could not be loaded or authenticated.';}
 else if(/unsatisfiable|unsatisfied|does not match signed KZG checkpoint|does not bind source epoch/iu.test(String(message))){code='LOCAL_PROOF_INPUT_REJECTED';reason='The proof inputs did not match the authenticated statement.';}
 return Object.assign(Error('Family proof: '+step+': '+reason),{code});
}
export const DEPOSIT_INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS';

// Classify only explicit rejection from the wallet or its transaction RPC.
// A transport failure or a generic wallet error can occur after broadcast.
export const DEPOSIT_USER_REJECTED = 'USER_REJECTED';
export const DEPOSIT_SUBMISSION_REJECTED = 'WALLET_SUBMISSION_REJECTED';
const submissionErrors=error=>{
 const queue=[error],seen=new Set(),values=[];
 while(queue.length&&seen.size<32){
  const item=queue.shift();if(!item||typeof item!=='object'||seen.has(item))continue;
  seen.add(item);values.push(item);
  for(const key of ['error','info','data','originalError','cause','receipt','transaction','response'])if(item[key]&&typeof item[key]==='object')queue.push(item[key]);
 }
 return {values,complete:queue.length===0};
};
export function depositWalletSubmissionCode(error){
 const {values,complete}=submissionErrors(error);
 // Never release the durable barrier when a transaction identity or an
 // explicitly ambiguous broadcast outcome accompanies a nested rejection.
 if(!complete||values.some(v=>[v.hash,v.transactionHash,v.txHash].some(h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/iu.test(h))||
  /\b(?:already known|nonce too low|replacement transaction|broadcast|timed out|timeout)\b/iu.test(String(v.message??''))))return undefined;
 const codes=new Set();
 for(const v of values){
  if(v.code===DEPOSIT_INSUFFICIENT_FUNDS||[-32000,-32003,-32603].includes(v.code)&&typeof v.message==='string'&&
    /\binsufficient funds for (?:gas\s*\*\s*price\s*\+\s*value|intrinsic transaction cost|transaction cost)\b/iu.test(v.message))codes.add(DEPOSIT_INSUFFICIENT_FUNDS);
  if(v.code===4001||v.code==='4001'||v.code===DEPOSIT_USER_REJECTED||v.code==='ACTION_REJECTED'&&v.reason==='rejected')codes.add(DEPOSIT_USER_REJECTED);
  if(v.code===DEPOSIT_SUBMISSION_REJECTED)codes.add(DEPOSIT_SUBMISSION_REJECTED);
 }
 return codes.size===1?[...codes][0]:undefined;
}
export function uncertainDepositSubmission(error){
 const {values}=submissionErrors(error);
 const codes=values.map(v=>v.code),message=values.map(v=>String(v.message??'')).join(' ');
 const detail=codes.includes(-32002)?' A wallet request is already open.':
  codes.includes(4100)||codes.includes(4900)||codes.includes(4901)?' The wallet reported an account, permission or network connection error.':
  codes.includes(-32602)?' The wallet reported invalid transaction parameters.':
  codes.includes(-32005)||/rate.?limit|too many requests/iu.test(message)?' The RPC reported a rate limit.':
  codes.includes('TIMEOUT')||/timed out|timeout/iu.test(message)?' The wallet or RPC timed out.':
  /nonce too low|already known|replacement transaction/iu.test(message)?' The RPC reported an existing or conflicting transaction.':
  ' The wallet did not return a confirmed transaction hash.';
 return Object.assign(Error('Family deposit: Submission outcome is uncertain.'+detail+' Check History; the deposit will not be resent automatically.'),{code:'AUTHORIZATION_UNCERTAIN'});
}
export function depositFailure(error,stage){
 if(known.has(error))return error;
 if(!DEPOSIT_STAGES.includes(stage))stage='Deposit intent';
 const fundedOperation=/^(?:Handle|Batch|Transfer|Route|Withdrawal|Transaction)/u.test(stage);
 const code=typeof error?.code==='string'&&/^[A-Z_]{1,64}$/u.test(error.code)?error.code:fundedOperation?'TRANSACTION_FAILED':'DEPOSIT_FAILED';
 const nested=error?.info?.error??error?.error;
 const rpcMessage=String(nested?.message??error?.shortMessage??error?.message??'').toLowerCase();
 let data=error?.data??nested?.data;if(data&&typeof data==='object')data=data.data??data.result??data.originalError?.data;
 const selector=typeof data==='string'&&/^0x[0-9a-f]{8}/iu.test(data)?data.slice(0,10).toLowerCase():null;
 let cause;
 if(code===DEPOSIT_USER_REJECTED&&stage==='Wallet submission')cause='The transaction was cancelled in the connected wallet. No deposit was submitted.';
 else if(code===DEPOSIT_SUBMISSION_REJECTED&&stage==='Wallet submission')cause='The wallet request was not submitted because its reviewed transaction or connected account no longer matched.';
 else if(code===DEPOSIT_INSUFFICIENT_FUNDS&&stage==='Wallet submission')cause='The connected wallet does not have enough native tokens to cover this deposit and its network fee.';
 else if(code==='RECOVERY_SUPERSEDED'&&stage==='Private balance recovery')cause='Balance recovery paused for a transaction.';
 else if(code==='CANONICAL_STATE_REJECTED'&&stage==='Private balance recovery')cause='The canonical pool history could not be verified. Refresh to retry.';
 else if(selector&&errors.has(selector))cause='Contract reverted: '+errors.get(selector)+' ('+selector+').';
 else if(/rate.?limit|too many requests/u.test(rpcMessage)||nested?.code===-32005)cause='RPC rate limit reached.';
 else if(/insufficient (?:funds|balance)/u.test(rpcMessage))cause='RPC rejected the deposit simulation: insufficient funds for value and gas.';
 else if(/timeout|timed out/u.test(rpcMessage)||code==='TIMEOUT')cause='The RPC request timed out.';
 else if(code==='CALL_EXCEPTION')cause=selector?'Contract reverted with error '+selector+'.':'Contract simulation reverted; the RPC returned no revert reason.';
 else if(safe(error?.message)&&/^(?:Private handle:|Private handle relay:|Public payment:|Private transfer(?::| plan | proof)|Enhanced fee service |Enhanced wallet |No available source epoch |Insufficient unlocked |Family [A-Za-z -]{1,50}[: ]|SDK family release:|Native wallet (?:screening|clearance) |Native clearance response |Partner (?:asset|configuration) |Configuration belongs |Asset is outside |This asset is not enabled |Current |Invalid direct deposit |Local deposit |Deposit source |The signed |Pinned |Missing signed |Invalid family )/u.test(error.message))cause=error.message;
 else if(['Failed to fetch','NetworkError when attempting to fetch resource.','Load failed'].includes(error?.message))cause='The network request failed.';
 else if(error?.name==='AbortError')cause='The operation was cancelled.';
 else if(code==='AUTHORIZATION_UNCERTAIN')cause='Submission could not be confirmed. The wallet is checking History and keeping the selected funds reserved until the outcome is clear.';
 else if(code==='SESSION_EXPIRED'||code==='PASSWORD_REQUIRED')cause='The wallet session has expired. Reconnect the wallet.';
 else cause='The '+stage.toLowerCase()+' step failed ('+code+').';
 const failure=Object.freeze({stage,code,cause});
 const result=Object.assign(Error(stage+': '+cause),{code,depositFailure:failure});known.add(result);return result;
}
export function publicDepositFailure(error){return known.has(error)?error.depositFailure:undefined;}
export function readDepositFailure(value){
 if(!value||Object.keys(value).sort().join()!=='cause,code,stage'||!DEPOSIT_STAGES.includes(value.stage)||
  typeof value.code!=='string'||!/^[A-Z_]{1,64}$/u.test(value.code)||!safe(value.cause))return null;
 const result=Object.assign(Error(value.stage+': '+value.cause),{code:value.code,depositFailure:Object.freeze({...value})});known.add(result);return result;
}
