import {getAddress} from 'ethers';
export function matchesReviewedDepositPolicy(quote,membership,fee,nowSeconds){
 return quote.deadline>nowSeconds&&membership.partnerId===quote.partnerId&&
  membership.version.toString()===quote.policyVersion&&membership.receiverCommitment.toString()===quote.receiverCommitment&&
  membership.authorizationKey.toString()===quote.authorizationKey&&fee.toString()===quote.partnerFeeAtomic;
}
/** Compare every reviewed field exactly; EVM addresses have a canonical value
 * independent of checksum casing used by another SDK component. */
export function matchesFamilyDepositApproval(review,actual,{wallet,pool,generationId,nowSeconds}){
 try{return Boolean(review&&actual&&Object.keys(actual).sort().join()===Object.keys(review).sort().join()&&
  Object.entries(review).every(([key,value])=>actual[key]===value)&&
  getAddress(review.payer)===getAddress(wallet)&&getAddress(review.pool)===getAddress(pool)&&
  review.generationId===generationId&&Number.isSafeInteger(review.deadline)&&review.deadline>nowSeconds);
 }catch{return false;}
}
