import {normalizeVantaError,normalizeVantaTransactionStatus,VANTA_ROUTE} from '../api/developer.mjs';
const stages=Object.freeze({
 createPrivateWallet:'wallet',restoreWallet:'wallet',unlockRememberedWallet:'wallet',selectAsset:'wallet',recoverNotes:'synchronizing',
 quoteDeposit:'quoting',quotePrivateSend:'quoting',quoteWithdrawal:'quoting',quotePublicBatch:'quoting',quoteRoute:'quoting',quoteRouteFees:'quoting',quotePayment:'quoting',
 previewNetworkGas:'quoting',prepareReviewedDeposit:'preparing',prepareReviewedPrivateSend:'preparing',prepareReviewedWithdrawal:'preparing',prepareReviewedPublicBatch:'preparing',prepareReviewedRoute:'preparing',prepareReviewedPayment:'preparing',
 prepareDeposit:'preparing',preparePrivateSend:'preparing',prepareRoute:'preparing',
 approveDepositAsset:'authorizing',approvePaymentAsset:'authorizing',executeDeposit:'authorizing',executePrivateSend:'authorizing',authorizeWithdrawal:'authorizing',authorizePublicBatch:'authorizing',executeRoute:'authorizing',executePayment:'authorizing',
 reconcileDeposit:'reconciling',reconcilePrivateSend:'reconciling',monitorWithdrawal:'reconciling',monitorPublicBatch:'reconciling',reconcileRoute:'reconciling',reconcilePayment:'reconciling',reconcileTransaction:'reconciling',
 listDepositHistory:'history',listPendingDeposits:'history',listPrivateSends:'history',listWithdrawals:'history',listRoutes:'history',listPendingPayments:'history',
});
/** Notify asynchronously; neither observer failure nor return value controls an operation. */
export function notifyProgress(listener,event){
 if(typeof listener!=='function')return;
 const value=Object.freeze(event);
 queueMicrotask(()=>{try{Promise.resolve(listener(value)).catch(()=>{});}catch{}});
}
export function observePartnerClient(client,listener){
 if(typeof listener!=='function')return Object.freeze(client);
 const observed={...client};
 for(const [method,stage] of Object.entries(stages)){
  if(typeof client[method]!=='function')continue;
  observed[method]=(...args)=>{
   notifyProgress(listener,{method,stage,state:'started'});
   let result;
   try{result=client[method](...args);}catch(error){
    notifyProgress(listener,{method,stage,state:'failed',code:normalizeVantaError(error,{submissionMayHaveStarted:stage==='authorizing'}).code});throw error;
   }
   Promise.resolve(result).then(
    ()=>notifyProgress(listener,{method,stage,state:'completed'}),
    error=>notifyProgress(listener,{method,stage,state:'failed',code:normalizeVantaError(error,{submissionMayHaveStarted:stage==='authorizing'}).code}));
   return result;
  };
 }
 return Object.freeze(observed);
}
/** Single reconciliation entry point; delegates to the original wallet journal paths. */
export async function reconcilePartnerTransaction(client,{operation,id,historyAsset,transactionHash}){
 if(typeof id!=='string'||!id||id.length>256)throw normalizeVantaError({code:'INVALID_ARGUMENT'});
 const original={preparedId:id,...(historyAsset===undefined?{}:{historyAsset})},named={transactionId:id,...(historyAsset===undefined?{}:{historyAsset})};
 let result;
 switch(operation){
  case 'deposit':result=await client.reconcileDeposit({...original,...(transactionHash===undefined?{}:{transactionHash})});break;
  case 'private-send':result=await client.reconcilePrivateSend(original);break;
  case 'withdrawal':case 'enhanced-withdrawal':result=await client.monitorWithdrawal({...named,enhanced:operation==='enhanced-withdrawal'});break;
  case 'public-batch':result=await client.monitorPublicBatch(named);break;
  case 'swap':case 'bridge':result=await client.reconcileRoute({...original,operation:operation==='swap'?VANTA_ROUTE.SWAP:VANTA_ROUTE.BRIDGE});break;
  default:throw normalizeVantaError({code:'INVALID_ARGUMENT'});
 }
 return normalizeVantaTransactionStatus({operation,id,result});
}
