/** Public fee review only. No note selection, witness, lookup or proof runs here. */
import{Interface,getAddress,keccak256,toUtf8Bytes}from'ethers';
import{getCompiledFamilyEvmRelease}from'./family-network.mjs';
import{getCompiledVantaFamilyProofResources}from'./family-proof-resources.mjs';
import{selectVantaFamilyFundingResources}from'./family-funding-resources.mjs';
import{VANTA_POLICY_REGISTRY_ABI,vantaPolicyPoseidon}from'./partner-policy-kzg.mjs';
import{normalizeFreshHandle}from'./family-deposit-route.mjs';
import{readVantaFamilyProtocolFees}from'./family-fee-policy.mjs';
const poolAbi=new Interface(['function minimumProtocolFee() view returns(uint128)']);
const addr=v=>getAddress(v).toLowerCase(),fail=m=>{throw Error('Family fee review: '+m);};
/** Fit the recipient amount inside an explicit total-spend ceiling. All money
 * stays integer-valued; rounding residue remains in the sender's private change.
 * The deployed circuit's recipient-based fee rules are unchanged. */
export function familyTotalSpendAmounts({maximumDebitAtomic,gasReserveAtomic,feeRules}){
 const uint=(v,zero=false)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,36})$/u.test(v)||BigInt(v)>=(1n<<120n)||(!zero&&BigInt(v)===0n))fail('Invalid total-spend amount.');return BigInt(v);};
 const budget=uint(maximumDebitAtomic),gas=uint(gasReserveAtomic),rules=feeRules;
 if(!rules||![rules.protocolBps,rules.partnerBps].every(v=>Number.isInteger(v)&&v>=0&&v<=10000))fail('Invalid total-spend fee rules.');
 const pmin=uint(rules.protocolMinimum,true),amin=uint(rules.partnerMinimum,true),amax=uint(rules.partnerMaximum,true);
 const fees=n=>{const p=(n*BigInt(rules.protocolBps)+9999n)/10000n,a=(n*BigInt(rules.partnerBps)+9999n)/10000n;return[p>pmin?p:pmin,a>amin?a:amin];};
 if(gas>=budget)fail('The entered amount does not cover the network fee.');
 let low=0n,high=budget-gas;
 while(low<high){const n=(low+high+1n)/2n,[p,a]=fees(n);if(n+p+a+gas<=budget)low=n;else high=n-1n;}
 if(low<=0n)fail('The entered amount does not cover the fees and network fee.');
 const[p,a]=fees(low);if(a>amax)fail('Partner fee exceeds its registered maximum.');
 const debit=low+p+a+gas;
 return Object.freeze({amountAtomic:low.toString(),protocolFeeAtomic:p.toString(),partnerFeeAtomic:a.toString(),gasReserveAtomic:gas.toString(),totalDebitAtomic:debit.toString(),unspentAmountAtomic:(budget-debit).toString()});
}
/** Start the same live policy checks independently of note recovery and gas
 * pricing. The returned calculator is local to this review, never a persisted
 * authorization. Funded preparation still rechecks the accepted terms. */
export async function prepareFamilyOperationFeeReview({provider,verificationProvider,releaseContext,asset,partnerHandle,operation}){
 if(![0,1,3,4,5].includes(operation))fail('Invalid amount or operation.');
 const release=getCompiledFamilyEvmRelease(releaseContext),resources=selectVantaFamilyFundingResources(release,getCompiledVantaFamilyProofResources(release,releaseContext),asset),d=resources.deployment;
 const roles=release.lock.contracts.filter(p=>p.name==='partner-registry');if(roles.length!==1)fail('Missing signed registry.');const registry=roles[0];
 const [a,b]=await Promise.all([provider.getBlock('latest'),verificationProvider.getBlock('latest')]),height=Math.min(a?.number,b?.number);if(!Number.isSafeInteger(height))fail('Canonical block unavailable.');
 const [x,y,ca,cb]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height),provider.getCode(registry.address,height),verificationProvider.getCode(registry.address,height)]);
 if(!x?.hash||x.hash!==y?.hash||keccak256(ca)!==registry.codehash||keccak256(cb)!==registry.codehash)fail('Signed registry or canonical block differs.');
 const both=async(to,abi,name,args=[])=>{const tx={to,data:abi.encodeFunctionData(name,args),blockTag:height},[a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);if(a!==b)fail('Canonical fee reads disagree.');return abi.decodeFunctionResult(name,a);};
 const handleId=await vantaPolicyPoseidon([BigInt(keccak256(toUtf8Bytes(normalizeFreshHandle(partnerHandle)))),BigInt(resources.chainId)]);
 const [[activePool],[partnerId],protocol,[minimum]]=await Promise.all([both(registry.address,VANTA_POLICY_REGISTRY_ABI,'activePoolForAsset',[d.asset]),both(registry.address,VANTA_POLICY_REGISTRY_ABI,'operationPartnerId',[handleId,operation]),readVantaFamilyProtocolFees({provider,verificationProvider,pool:d.pool,blockTag:height,releaseContext}),both(d.pool,poolAbi,'minimumProtocolFee')]);
 if(addr(activePool)!==addr(d.pool))fail('The current pool differs from this signed generation.');
 const [found,slot]=await both(registry.address,VANTA_POLICY_REGISTRY_ABI,'partnerSlot',[d.pool,partnerId]);if(!found)fail('Partner fee policy is not registered.');
 const [row]=await both(registry.address,VANTA_POLICY_REGISTRY_ABI,'partnerAt',[d.pool,slot]);if(!row.active||BigInt(row.partnerId)!==BigInt(partnerId)||row.receiverCommitment<=0n||row.authorizationKey<=0n)fail('Partner fee policy is inactive.');
 const feeRules=Object.freeze({protocolBps:Number(protocol.rates[operation]),protocolMinimum:minimum.toString(),partnerBps:Number(row.feeBps),partnerMinimum:row.feeMinimum.toString(),partnerMaximum:row.feeMaximum.toString()});
 const deadline=Math.floor(Date.now()/1000)+300;
 return async ({amountAtomic,maximumDebitAtomic,gasReserveAtomic})=>{
 if(typeof amountAtomic!=='string'||!/^[1-9][0-9]{0,36}$/u.test(amountAtomic)||BigInt(amountAtomic)>=(1n<<120n))fail('Invalid amount or operation.');
 let amounts;
 if(maximumDebitAtomic!==undefined){if(BigInt(maximumDebitAtomic)>BigInt(amountAtomic))fail('The total-spend ceiling exceeds the entered amount.');amounts={...familyTotalSpendAmounts({maximumDebitAtomic,gasReserveAtomic,feeRules}),grossAmountAtomic:amountAtomic};}
 else{const n=BigInt(amountAtomic),rate=v=>(n*BigInt(v)+9999n)/10000n;let partner=rate(row.feeBps),fee=rate(protocol.rates[operation]);if(partner<row.feeMinimum)partner=row.feeMinimum;if(partner>row.feeMaximum)fail('Partner fee exceeds its registered maximum.');if(fee<minimum)fee=minimum;amounts={amountAtomic,protocolFeeAtomic:fee.toString(),partnerFeeAtomic:partner.toString(),totalDebitAtomic:(n+fee+partner).toString()};}
 const [endA,endB]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);if(endA?.hash!==x.hash||endB?.hash!==x.hash)fail('Canonical fee block changed.');
 return Object.freeze({...amounts,feeRules,pool:d.pool,asset:d.asset,generationId:resources.generationId,
  feePolicyHash:protocol.policyHash,partnerId:partnerId.toLowerCase(),policyVersion:row.version.toString(),receiverCommitment:row.receiverCommitment.toString(),authorizationKey:row.authorizationKey.toString(),deadline});
 };
}
export async function quoteFamilyOperationFees(input){
 const review=await prepareFamilyOperationFeeReview(input);
 return review(input);
}
export function assertFamilyReviewedFees(review,actual){
 if(!review||review.deadline<=Date.now()/1000+30)fail('The review expired. Review the current fees again.');
 if(review.gasReserveAtomic!==undefined&&BigInt(review.gasReserveAtomic)!==BigInt(actual.gasReserveAtomic))fail('The gas reserve changed. Review the current fees again.');
 if(review.grossAmountAtomic!==undefined&&BigInt(actual.totalDebitAtomic)>BigInt(review.grossAmountAtomic))fail('The transaction exceeds the reviewed total spend.');
 for(const key of ['amountAtomic','protocolFeeAtomic','partnerFeeAtomic','totalDebitAtomic','feePolicyHash','partnerId','policyVersion','receiverCommitment','authorizationKey']){let same=false;try{same=key==='feePolicyHash'?String(review[key]).toLowerCase()===String(actual[key]).toLowerCase():BigInt(review[key])===BigInt(actual[key]);}catch{}if(!same)fail('The fees or receiving policy changed. Review the current fees again.');}
}
