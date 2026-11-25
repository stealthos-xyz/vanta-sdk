/** Public, non-authorizing helpers for display and integration. */
export const VANTA_ROUTE=Object.freeze({SWAP:4,BRIDGE:5});

const messages=Object.freeze({
 INVALID_ARGUMENT:'Check the requested operation and its inputs.',
 NOT_READY:'The required wallet runtime is not ready.',
 PERMISSION_DENIED:'The wallet session does not permit this operation.',
 SESSION_EXPIRED:'Reconnect or unlock the wallet.',
 PASSWORD_REQUIRED:'Unlock the wallet.',
 USER_REJECTED:'The wallet request was declined. Reconcile if submission may have started.',
 WALLET_SUBMISSION_REJECTED:'The reviewed wallet request was rejected. Reconcile before another attempt.',
 INSUFFICIENT_FUNDS:'Check available balance and required network fees.',
 INTENT_NOT_FOUND:'The original transaction intent was not found.',
 INTENT_EXPIRED:'Reconcile the original intent and obtain a fresh review.',
 INVALID_REVIEW:'The reviewed transaction is no longer valid.',
 INVALID_STATUS:'The transaction status could not be interpreted.',
 STATE_CHANGED:'The wallet context or transaction state changed.',
 AUTHORIZATION_UNCERTAIN:'Submission may have occurred. Reconcile the original transaction; do not resend.',
 AUTHORIZATION_ALREADY_ATTEMPTED:'Authorization was already attempted. Reconcile the original transaction.',
 STORE_UNAVAILABLE:'Private storage is unavailable. Preserve the journal.',
 RUNTIME_UNAVAILABLE:'The wallet runtime is unavailable.',
 LOCAL_PROOF_FAILED:'Local proof generation failed.',
 LOCAL_PROOF_RUNTIME_FAILED:'The local proof runtime stopped.',
 LOCAL_PROOF_WORKER_FAILED:'A local proof worker stopped.',
 LOCAL_PROOF_ARTIFACT_UNAVAILABLE:'A pinned proof resource is unavailable.',
 LOCAL_PROOF_INPUT_REJECTED:'The local proof inputs were rejected.',
 DEPOSIT_FAILED:'The deposit operation failed. Check its history.',
 TRANSACTION_FAILED:'The transaction operation failed. Check its history.',
 CALL_EXCEPTION:'A contract call failed. Reconcile before another attempt.',
 UNKNOWN:'The operation failed. Check the wallet context and original transaction history.',
});
export const VANTA_ERROR_CODES=Object.freeze(Object.keys(messages));
const recovery=code=>['AUTHORIZATION_UNCERTAIN','AUTHORIZATION_ALREADY_ATTEMPTED','TRANSACTION_FAILED','DEPOSIT_FAILED','CALL_EXCEPTION','UNKNOWN','WALLET_SUBMISSION_REJECTED','USER_REJECTED'].includes(code)?'reconcile':
 ['SESSION_EXPIRED','PASSWORD_REQUIRED','PERMISSION_DENIED'].includes(code)?'reconnect':
 ['INVALID_REVIEW','INTENT_EXPIRED','STATE_CHANGED','INSUFFICIENT_FUNDS','INTENT_NOT_FOUND','INVALID_ARGUMENT'].includes(code)?'review-again':'inspect';
export class VantaSdkError extends Error {
 constructor(code='UNKNOWN'){
  const safe=typeof code==='string'&&Object.hasOwn(messages,code)?code:'UNKNOWN';
  super(messages[safe]);this.name='VantaSdkError';this.code=safe;this.recovery=recovery(safe);
 }
}
/** Sanitize for the application's UI; never copy upstream messages or secrets. */
export function normalizeVantaError(error,{submissionMayHaveStarted=false}={}){
 let code=error?.code;
 if(code===4001||code==='4001')code='USER_REJECTED';
 if(submissionMayHaveStarted&&code!=='AUTHORIZATION_ALREADY_ATTEMPTED')code='AUTHORIZATION_UNCERTAIN';
 return new VantaSdkError(code);
}
const kinds=new Set(['deposit','payment','private-send','withdrawal','enhanced-withdrawal','public-batch','swap','bridge']);
const phases=new Set(['proving','prepared','submitting','broadcast-uncertain','included','finalized','failed-finalized','failed','expired-unused','cancelled','private-output-pending']);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/iu.test(value)?value:null;
/** Display status only. Source finality is not cross-chain delivery or a completed delayed payout. */
export function normalizeVantaTransactionStatus({operation,id,result}){
 if(!kinds.has(operation)||!result||typeof result!=='object')throw new VantaSdkError('INVALID_STATUS');
 const returned=result.transactionId??result.preparedId;
 if(id!==undefined&&returned!==undefined&&id!==returned)throw new VantaSdkError('INVALID_STATUS');
 const transactionId=returned??id;
 if(typeof transactionId!=='string'||!transactionId||transactionId.length>256)throw new VantaSdkError('INVALID_STATUS');
 const status=result.status??result;
 let phase='unknown',complete=false,transactionHash=hash(result.transactionHash??status.transactionHash),outputTransactionHash=null;
 if(operation==='enhanced-withdrawal'){
  const claims=status.claims;
  complete=status.authorized===true&&status.authorizationFailed!==true&&status.recoveryRequired!==true&&status.total===3&&status.completed===3&&Array.isArray(claims)&&claims.length===3&&claims.every((claim,i)=>claim.number===i+1&&claim.state==='finalized'&&hash(claim.transactionHash));
  phase=complete?'finalized':status.recoveryRequired===true?'recovery-required':status.authorizationFailed===true?'failed':status.authorized===true?'awaiting-claims':'pending';
 }else if(operation==='public-batch'){
  complete=status.authorized===true&&status.finalized===true&&status.authorizationFailed!==true&&transactionHash!==null;
  phase=complete?'finalized':status.authorizationFailed===true?'failed':status.authorized===true?'included':'pending';
 }else{
  if(phases.has(result.phase))phase=result.phase;
  complete=phase==='finalized'&&transactionHash!==null;
  if(phase==='finalized'&&!transactionHash)phase='unknown';
  if(operation==='bridge'&&phase==='finalized'){
   const delivery=result.delivery;
   outputTransactionHash=hash(delivery?.transactionHash);
   complete=complete&&delivery?.phase==='delivered-finalized'&&outputTransactionHash!==null;
   phase=complete?'finalized':delivery?.phase==='delivery-failed'?'delivery-failed':'awaiting-delivery';
  }else if(operation==='swap'&&result.privateOutput===true){
   outputTransactionHash=hash(result.outputTransactionHash);
   if(phase==='finalized'&&!outputTransactionHash){phase='private-output-pending';complete=false;}
  }
 }
 return Object.freeze({id:transactionId,operation,phase,complete,transactionHash,outputTransactionHash});
}
