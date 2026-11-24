import{prepareFamilyOperationFeeReview,assertFamilyReviewedFees} from './family-operation-review.mjs';
import{prepareFamilyNetRoute} from './family-route-review.mjs';
import {familyBridgeRoutes,familyBridgeRoutesForTarget,verifyFamilyBridgeGateway} from './family-bridge-gateway.mjs';
import {createVantaFamilyPartnerAssetConfiguration} from './family-partner-app-config.mjs';
import {getConfirmedBlock,getSharedConfirmedBlock} from './transaction-confirmations.mjs';
/** Client-local proofs and proof-bound private gas reimbursement. The shared
 * relayer broadcasts all funded outward operations; never the customer's EOA. */
import {getAddress,keccak256,recoverAddress,randomBytes,hexlify} from 'ethers';
import {getCompiledFamilyEvmRelease,verifyCompiledFamilyOperationRuntime,isFamilyWithdrawalOnlyContext} from './family-network.mjs';
import {createVantaFamilyProofRuntime} from './family-proof-runtime.mjs';
import {createVantaFamilyPartnerRegistry} from './family-partner-registry.mjs';
import {createVantaEnhancedFundingRuntime} from './family-enhanced-funding-runtime.mjs';
import {createFamilyNoteDelivery,normalizeFamilyPrivateMemo,FAMILY_PRIVATE_MEMO_MAX_BYTES} from './family-note-delivery.mjs';
import {recoverFamilyCanonicalNotes} from './family-note-recovery.mjs';
import {createFamilySpendFence} from './family-spend-fence.mjs';
import {selectFamilyPrivateSendNotes} from './family-normal-selection.mjs';
import {readVantaFamilyProtocolFees} from './family-fee-policy.mjs';
import {familyNormalAbi as ABI,familyNormalDigest} from './family-normal-wire.mjs';
import {prepareFamilyPrivateSendPlan,proveFamilyPrivateSendPlan,prepareFamilyWithdrawalPlan,proveFamilyWithdrawalPlan} from './family-normal-plan.mjs';
import {prepareFamilyRoutedPlan,proveFamilyRoutedPlan} from './family-normal-plan.mjs';
import {getCompiledVantaFamilyProofResources} from './family-proof-resources.mjs';
import {validateVantaFamilyFundingResources} from './family-funding-resources.mjs';
import {familyRouteAbi,familyRoutePredictMethod,familyRoutedAbi,validateFamilyRoute,encodeFamilyRoutedCall,validateSavedFamilyRoutedCall,familyRouteHash} from './family-routed-wire.mjs';
import {hasPrivateSwapOutput,privateSwapOutputScope,privateSwapOutputEscrow,verifyPrivateSwapOutput} from './family-private-swap-output-wire.mjs';
import {createPrivateSwapHost} from './family-private-swap-settlement.mjs';
import {createFamilyBridgeDeliveryMonitor} from './family-bridge-delivery.mjs';
import {allocateFamilyBatchPayouts} from './family-batch-review.mjs';
import {normalizeFamilyBatchPayout,familyBatchPayoutScope,verifyFamilyBatchPayout,validateFamilyBatchPayout,encodeFamilyBatchPayout,decodeFamilyBatchPayout,familyBatchPayoutAbi,familyBatchPayoutHash} from './family-batch-payout-wire.mjs';
export {normalizeFamilyPrivateMemo,FAMILY_PRIVATE_MEMO_MAX_BYTES};
export {encodeVantaFamilyReceivingAddress,decodeVantaFamilyReceivingAddress} from './family-normal-address.mjs';
const fail=message=>{throw Error('Private transfer: '+message);},safe=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
const terminal=row=>['finalized','failed-finalized','expired-unused','cancelled'].includes(row.phase);
export const createVantaFamilyPrivateSendHost=options=>createNormalHost(options,1);
export const createVantaFamilyRoutedHost=async options=>{
 if(![4,5].includes(options?.operation))fail('Select a supported swap or bridge operation.');
 const source=await createNormalHost({...options,approvePrivateSend:options.approveRoute},options.operation);
 return options.operation===4&&hasPrivateSwapOutput(getCompiledFamilyEvmRelease(options.releaseContext))?createPrivateSwapHost({...options,source}):source;
};
export const createVantaFamilyWithdrawalHost=options=>createNormalHost(options,0);
async function createNormalHost({walletController,store,provider,verificationProvider,relayerUrl,walletAddress,
 artifactBaseUrl,fetcher=fetch,signal,onProgress,asset='native',releaseContext,approvePrivateSend,partnerAssetConfiguration}={},operation){
 const routed=[4,5].includes(operation);
 if(!provider||!verificationProvider||provider===verificationProvider||!store||typeof walletController?.requireWallet!=='function'||
  typeof approvePrivateSend!=='function')fail('Trusted wallet, store and transaction approval are required.');
 const release=getCompiledFamilyEvmRelease(releaseContext),wallet=walletController.requireWallet(),payer=getAddress(walletAddress).toLowerCase(),origin=new URL(relayerUrl);
 const baseRoutes=routed?validateVantaFamilyFundingResources(getCompiledVantaFamilyProofResources(release,releaseContext).funding,release).routes:undefined;
 const privateScope=operation===4&&hasPrivateSwapOutput(release)?privateSwapOutputScope(release):null;
 const operationalRoutes=routed?familyBridgeRoutes(release,baseRoutes,operation):baseRoutes;
 const routes=privateScope?{...operationalRoutes,privateOutput:true,gateway:{...operationalRoutes.gateway,address:privateScope.gateway,codehash:privateScope.gatewayCodehash}}:operationalRoutes;
 const routeAbi=routed?familyRouteAbi(routes):null;
 if(routed&&!routes)fail('This release has no signed external routes.');
 const transactionTarget=routed?routes.gateway.address:undefined;
 const batchScope=()=>familyBatchPayoutScope(release);
 const routesForRow=row=>operation===5?familyBridgeRoutesForTarget(release,baseRoutes,row.q?.relayer):routes;
 const targetFor=row=>row.batch?batchScope().gateway:routed?routesForRow(row).gateway.address:d.pool;
 if(operation!==0&&isFamilyWithdrawalOnlyContext(releaseContext))fail('Historical pools are available for withdrawal only.');
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)fail('Use the authenticated HTTPS app gateway.');
 const funding=await createVantaEnhancedFundingRuntime({asset,releaseContext,artifactBaseUrl,fetcher,signal,onProgress}),r=funding.resources,d=r.deployment,native=r.profiles.normal8.runtime,
  domain={schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:r.chainId,familyTag:r.familyTag,genesisHash:r.genesisHash,generationId:r.generationId,
   setupId:d.setupId,pool:d.pool,asset:d.asset,poolCodehash:d.poolCodehash,nativeGlueSha256:native.glue.sha256,nativeWasmSha256:native.wasm.sha256};
 const appAssets=partnerAssetConfiguration?createVantaFamilyPartnerAssetConfiguration({...partnerAssetConfiguration,provider,verificationProvider,releaseContext,fetcher}):null;
 const enabled=async()=>{if(appAssets){await appAssets.refresh();appAssets.requireAsset(d.asset,{operation:operation===0?'withdraw':operation===1?'private-transfer':operation===4?'swap':'bridge'});}};
 let proofs,registry,deliveryMonitor,warming,closed=false,busy=false;const quotes=new Map();
 const bridgeMonitor=()=>deliveryMonitor??=createFamilyBridgeDeliveryMonitor({routes,signal});
 const live=()=>{signal?.throwIfAborted();if(closed||walletController.requireWallet()!==wallet)fail('Wallet changed or locked.');};
 const verifyOperation=async()=>{
  await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,d.pool,releaseContext,routed?[privateScope?'private-swap-gateway':'route-gateway']:[])));
  if(operation===5)await verifyFamilyBridgeGateway({providers:[provider,verificationProvider],release,routes:baseRoutes,block:await getSharedConfirmedBlock(provider,verificationProvider)});
 };
 try{proofs=await createVantaFamilyProofRuntime({provider,artifactBaseUrl,fetcher,signal,onProgress,releaseContext});
 registry=await createVantaFamilyPartnerRegistry({provider,verificationProvider,artifactBaseUrl,proofRuntime:proofs,fetcher,signal,releaseContext});
 const delivery=createFamilyNoteDelivery({domain,engine:await funding.noteEngine()}),fences=createFamilySpendFence({store,pool:d.pool}),
  namespace=(routed?'family-routed-v1/'+operation:operation===0?'family-public-withdrawals-v1':'family-private-sends-v1')+'/'+d.pool;
 if(routed&&!(operation===4?[routes.nativePool,routes.usdcPool].includes(d.pool):d.pool===routes.bnmPool))fail('This asset does not support the selected route.');
 if(!store.scope.endsWith('/'+release.pins.networkId+'/'+r.generationId))fail('Journal belongs to another generation.');
 const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/u.test(v),validCalldata=v=>typeof v==='string'&&/^0x(?:[0-9a-f]{2})+$/u.test(v)&&v.length<=524290;
 const rows=async()=>{const list=await store.read(namespace);if(!Array.isArray(list)||list.length>256||new Set(list.map(r=>r?.id)).size!==list.length)fail('Invalid encrypted journal.');
  for(const row of list)if(!['stealthos-family-private-send-v1','stealthos-family-private-send-v2'].includes(row?.schema)||row.pool!==d.pool||row.generationId!==r.generationId||
   !/^send_[0-9a-f]{64}$/u.test(row.id??'')||!Array.isArray(row.nullifiers)||row.nullifiers.length<1||row.nullifiers.length>32||
   row.nullifiers.some(n=>!word(n))||new Set(row.nullifiers).size!==row.nullifiers.length||
   !Number.isSafeInteger(row.anchorBlock)||row.anchorBlock<d.deploymentBlock||
   !row.q||row.q.pool!==d.pool||row.q.asset!==d.asset||row.q.chainId!==domain.chainId||row.q.mode!==operation||
   ![8,32].includes(row.q.width)||row.nullifiers.length>row.q.width||!word(row.q.nonce)||
   !Number.isSafeInteger(row.q.deadline)||row.q.deadline<=0||row.q.relayer!==(row.batch?batchScope().gateway:routed?targetFor(row):row.relayWallet??payer)||
   (row.schema==='stealthos-family-private-send-v2'&&(!/^0x[0-9a-f]{40}$/u.test(row.relayWallet??'')||BigInt(row.q.relayerFeeCap)<=0n||typeof row.prequoteToken!=='string'))||
   (row.transactionHash!==undefined&&!word(row.transactionHash))||
   (row.calldata!==undefined&&(!validCalldata(row.calldata)||!word(row.calldataHash)||keccak256(row.calldata)!==row.calldataHash))||
   // An unsigned proof can fail before calldata exists and later reconcile
   // as expired-unused. Such a row can never carry transaction evidence.
   (row.calldata===undefined&&(row.calldataHash!==undefined||row.transactionHash!==undefined||
    !['proving','failed','cancelled','expired-unused'].includes(row.phase)))||
   !['proving','prepared','submitting','included','finalized','failed-finalized','failed','expired-unused','cancelled'].includes(row.phase))fail('Invalid encrypted journal.');
  for(const row of list)if(row.batch){if(operation!==0)fail('Invalid batch journal.');validateFamilyBatchPayout(batchScope(),row.q,row.batch);}
  if(routed)for(const row of list){if(row.schema==='stealthos-family-private-send-v2')validateFamilyRoute({routes:routesForRow(row),route:row.route,q:row.q,payer:row.relayWallet,operation});
   if(operation===5&&(!Number.isSafeInteger(row.destinationAnchor?.number)||row.destinationAnchor.number<0||!word(row.destinationAnchor.hash)))fail('Invalid destination anchor.');}return list;};
 const read=async id=>{const row=(await rows()).find(r=>r.id===id);if(!row)fail('Saved transfer not found.');return row;};
 const set=(id,update)=>store.transact(namespace,list=>{const i=list.findIndex(r=>r.id===id);if(i<0)fail('Saved transfer not found.');const next=list.slice();next[i]=update(next[i]);return {next,result:next[i]};});
 const anchor=async()=>{const [a,b]=await Promise.all([getConfirmedBlock(provider),getConfirmedBlock(verificationProvider)]);
  if(!a?.hash||!b?.hash)fail('Confirmed block unavailable.');const height=Math.min(a.number,b.number),[x,y]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
  if(x?.hash!==y?.hash)fail('Canonical RPC state differs.');return x;};
 const both=async(name,args,block)=>{const tx={to:d.pool,data:ABI.encodeFunctionData(name,args),blockTag:block.number},[a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
  live();if(a!==b)fail('Canonical contract reads disagree.');return ABI.decodeFunctionResult(name,a);};
 const post=async(operation,body)=>{live();const response=await fetcher(new URL('/api/vanta-v8/'+(routed?'routed':'normal')+'/'+operation,origin),{method:'POST',redirect:'error',signal,
  headers:{'Content-Type':'application/json'},body:JSON.stringify(safe(body))});
  if(!response.body||Number(response.headers.get('content-length'))>32768)fail('Relayer response is unavailable.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>32768)fail('Fee response exceeds its limit.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let n=0;for(const part of chunks){bytes.set(part,n);n+=part.length;}live();const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!response.ok)fail(typeof result.error==='string'&&/^(?:Relayer gas:|Relayer submission:|The private transaction)/u.test(result.error)&&result.error.length<240?result.error:'Relayer authorization is unavailable.');return result;};
 const inventory=()=>recoverFamilyCanonicalNotes({provider,verificationProvider,delivery,wallet,deploymentBlock:d.deploymentBlock});
 const review=row=>Object.freeze({...row.review,preparedId:row.id,phase:row.phase,transactionHash:row.transactionHash??null,transactionDigest:row.calldataHash??null,
  ...(row.batch?{batch:true,recipientCount:row.batch.recipients.length,payments:row.review.payments}:{}),
  ...(routed?{transactionTarget:targetFor(row),publicReceiver:row.route.receiver,minimumOutputAtomic:row.route.minimumOutput,maximumDeliveryFeeAtomic:row.route.maximumDeliveryFee,
   ...(row.outputAmountAtomic?{outputAmountAtomic:row.outputAmountAtomic}:{}),
   ...(operation===5?{destinationChainId:routes.destination.chainId,messageId:row.messageId??null,delivery:row.delivery??null}:{})}:{})});
 const simulate=async row=>{if(!row.calldata||keccak256(row.calldata)!==row.calldataHash)fail('Saved calldata differs.');await verifyOperation();
  if(row.batch){
   const scope=batchScope(),block=await provider.getBlock('latest');
   await verifyFamilyBatchPayout(provider,scope,d.pool,d.poolCodehash,block.number);
   decodeFamilyBatchPayout(scope,row.q,row.batch,row.calldata);
  }else if(routed){validateSavedFamilyRoutedCall({routes:routesForRow(row),route:row.route,q:row.q,payer:row.relayWallet??payer,operation,calldata:row.calldata});
   const request={to:targetFor(row),data:routeAbi.encodeFunctionData(familyRoutePredictMethod(routesForRow(row)),[row.route]),blockTag:'latest'},[a,b]=await Promise.all([provider.call(request),verificationProvider.call(request)]);
   if(a!==b||routeAbi.decodeFunctionResult(familyRoutePredictMethod(routes),a)[0].toLowerCase()!==row.q.recipient)fail('Route escrow differs.');
  }else{const decoded=ABI.parseTransaction({data:row.calldata});if(decoded?.name!=='settleNormalEpoch'+row.q.width||familyNormalDigest(decoded.args[0])!==familyNormalDigest(row.q))fail('Saved quote differs.');}
  const [head,independent]=await Promise.all([provider.getBlock('latest'),verificationProvider.getBlock('latest')]);
  if(!head?.hash||!independent?.hash||Math.max(head.timestamp,independent.timestamp)+30>=row.q.deadline)fail('Transfer review expired. Reconcile it before preparing another.');
  const tx={from:row.relayWallet??payer,to:targetFor(row),data:row.calldata,value:routed?BigInt(row.route.maximumDeliveryFee):0n,blockTag:'pending'},[a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
  live();if(a!==b)fail('Transaction simulations disagree.');};
 const api={context:Object.freeze({networkId:release.pins.networkId,generationId:r.generationId,pool:d.pool,asset:d.asset,assetSymbol:d.assetSymbol,assetDecimals:d.assetDecimals}),
  async warmProofRuntime(){live();warming??=Promise.all([funding.warm({width:8}),funding.warm({width:32}),proofs.warmDepositRuntime()]).then(()=>{live();}).catch(error=>{warming=undefined;throw error;});return warming;},
  async receivingAddress(){live();return delivery.walletRecipient(wallet);},
  async balance(){live();const recovered=await inventory();if(!recovered.complete)fail('Note recovery is incomplete.');return {balanceAtomic:recovered.verifiedSpendableAtomic,pool:d.pool,asset:d.assetSymbol,assetDecimals:d.assetDecimals};},
  async quoteBatch({payments,partnerHandle}){
   if(operation!==0||isFamilyWithdrawalOnlyContext(releaseContext))fail('Batch send is unavailable for this pool.');
   batchScope();
   const batch=normalizeFamilyBatchPayout({recipients:payments.map(row=>row.recipient),amounts:payments.map(row=>row.amountAtomic)});
   return api.quote({partnerHandle,amountAtomic:batch.total.toString(),
    payments:batch.recipients.map((recipient,i)=>({recipient,amountAtomic:batch.amounts[i]}))});
  },
  async quote(input){
   // Quote while the user edits; only initialize public software/material.
   // Witnesses and proofs remain behind prepareReviewed after confirmation.
   void api.warmProofRuntime().catch(()=>{});
   live();if(typeof input.amountAtomic!=='string'||!/^[1-9][0-9]{0,36}$/u.test(input.amountAtomic)||BigInt(input.amountAtomic)>=(1n<<120n))fail('Enter a positive supported total amount.');
   const gross=BigInt(input.amountAtomic);
   const batchRecipients=input.payments?.length;
   if(privateScope&&!input.privateOutput)fail('A private swap output is required.');
   let verifyOutput=async()=>{};
   if(input.privateOutput){
    const scope=privateSwapOutputScope(release),intent=input.privateOutput,output=getCompiledVantaFamilyProofResources(release,releaseContext).funding.pools.find(p=>p.pool===intent.outputPool);
    if(operation!==4||!output||intent.outputPool===(d.pool)||privateSwapOutputEscrow(scope,{pool:output.pool,owner:intent.owner,salt:intent.salt})!==input.receiver)fail('Private swap receiver differs.');
    verifyOutput=async()=>{const at=await anchor();await verifyPrivateSwapOutput(provider,scope,output.pool,output.poolCodehash,at.number);};
   }
   const requestGas=width=>post('gas',{asset,partnerHandle:input.partnerHandle,operation,width,maximumDeliveryFee:routed?input.maximumDeliveryFeeAtomic??'0':'0',...(batchRecipients?{batchRecipients}:{}),...(input.privateOutput?{privateOutput:input.privateOutput}:{})});
   // No signatures, reservations, witnesses or proofs: all independent live
   // review reads overlap. Gas starts as soon as note width is known, without
   // waiting for the additional route/destination dependency checks.
   const selection=Promise.all([inventory(),fences.blocked()]).then(([recovered,blocked])=>{
    const selected=selectFamilyPrivateSendNotes(recovered,blocked,gross);if(!selected)fail('Insufficient unlocked private balance.');return selected;
   });
   const [selected,gas,feeReview,netRoute]=await Promise.all([selection,selection.then(s=>requestGas(s.width)),
    prepareFamilyOperationFeeReview({provider,verificationProvider,releaseContext,asset,partnerHandle:input.partnerHandle,operation}),
    routed?prepareFamilyNetRoute({provider,verificationProvider,releaseContext,asset,operation,slippageBps:input.slippageBps??100,receiver:input.receiver}):null,
    verifyOutput()]);live();
   if(gas.schema!=='stealthos-family-relay-gas-v1'||gas.pool!==d.pool||gas.asset!==d.asset||gas.generationId!==r.generationId||gas.operation!==operation||gas.width!==selected.width||
    !/^0x[0-9a-f]{40}$/u.test(gas.relayWallet??'')||typeof gas.gasReserveAtomic!=='string'||!/^[1-9][0-9]{0,36}$/u.test(gas.gasReserveAtomic)||typeof gas.token!=='string'||gas.expiresAt<=Date.now()/1000+60||
    (batchRecipients&&(gas.batchRecipients!==batchRecipients||gas.batchGateway!==batchScope().gateway)))fail('A current nonzero relayer gas quote is required.');
   const spendable=BigInt(selected.totalAtomic)-(operation===1?1n:2n),maximumDebitAtomic=(gross<spendable?gross:spendable).toString();
   const fees=await feeReview({amountAtomic:input.amountAtomic,maximumDebitAtomic,gasReserveAtomic:gas.gasReserveAtomic});live();
   const routeQuote=netRoute?await netRoute(fees.amountAtomic):undefined;
   if(routeQuote&&BigInt(routeQuote.maximumDeliveryFeeAtomic)>BigInt(input.maximumDeliveryFeeAtomic??'0'))fail('The bridge delivery fee changed. Review a fresh quote.');
   const normalized={...input,amountAtomic:fees.amountAtomic,...(routeQuote?{minimumOutputAtomic:routeQuote.minimumOutputAtomic}:{})};
   const payments=batchRecipients?allocateFamilyBatchPayouts(input.payments,fees.amountAtomic):undefined;
   if(payments)normalized.payments=payments;
   const quote=Object.freeze({...fees,quoteId:hexlify(randomBytes(32)),recipient:input.recipient,
    ...(payments?{payments,netPayoutAtomic:fees.amountAtomic,asset:d.assetSymbol,expiresAt:Math.min(fees.deadline,gas.expiresAt)}:{}),
    ...(routed?{publicReceiver:getAddress(input.receiver).toLowerCase(),minimumOutputAtomic:normalized.minimumOutputAtomic,maximumDeliveryFeeAtomic:input.maximumDeliveryFeeAtomic??'0',amountOutAtomic:routeQuote.amountOutAtomic,outputDecimals:routeQuote.outputDecimals}:{})});
   if(quotes.size>=4)quotes.delete(quotes.keys().next().value);quotes.set(quote.quoteId,{quote,input:structuredClone(normalized),gas});return quote;
  },
  async prepareReviewed({quoteId,batch=false,memo}){const saved=quotes.get(quoteId);if(!saved||Boolean(saved.input.payments)!==batch)fail('Review the current fees first.');quotes.delete(quoteId);return api.prepare({...saved.input,memo},saved.quote,saved.gas);},
  async prepare(input,expectedReview,gas){
   if(!expectedReview||!gas)fail('Review the current fees and gas reserve before preparing a proof.');
   const {amountAtomic,partnerHandle,payments}=input;
   if (operation!==1 && input.memo!==undefined) fail('Memos are only available for private transfers.');
   const memo = operation===1 ? normalizeFamilyPrivateMemo(input.memo) : undefined;
   const batch=payments?{recipients:payments.map(row=>row.recipient),amounts:payments.map(row=>row.amountAtomic)}:undefined;
   const recipient=operation===0&&!batch?getAddress(input.recipient).toLowerCase():input.recipient;
   live();if(busy)fail('Another transfer is in progress.');busy=true;let id,reserved=false,saved=false;
   try{await enabled();if(typeof amountAtomic!=='string'||!/^[1-9][0-9]{0,36}$/u.test(amountAtomic)||BigInt(amountAtomic)>=(1n<<120n))fail('Enter a positive supported amount.');
    await verifyOperation();const recovered=await inventory(),blocked=await fences.blocked(),initial=selectFamilyPrivateSendNotes(recovered,blocked,BigInt(expectedReview.totalDebitAtomic)+(operation===1?1n:2n),gas.width);
    if(!initial)fail('Insufficient unlocked private balance.');
    const requestRoute=routed?{operation,receiver:getAddress(input.receiver).toLowerCase(),amount:amountAtomic,
     minimumOutput:input.minimumOutputAtomic,maximumDeliveryFee:input.maximumDeliveryFeeAtomic??'0',...(input.privateOutput?{...input.privateOutput}:{} )}:undefined;
    if(routed&&(!/^[1-9][0-9]{0,36}$/u.test(requestRoute.minimumOutput)||! /^(0|[1-9][0-9]{0,20})$/u.test(requestRoute.maximumDeliveryFee)))fail('Enter valid minimum output and bridge fee limits.');
    const block=await anchor(),policy=await readVantaFamilyProtocolFees({provider,verificationProvider,pool:d.pool,releaseContext,blockTag:block.number}),
     prequoteBody=selected=>({asset,partnerHandle,sourceEpoch:selected.source.epoch,width:selected.width,payer,gasQuoteToken:gas.token,
      ...(operation===0?{operation:0,...(batch?{batch}:{withdrawal:{recipient,amount:amountAtomic}})}:{}),...(routed?{route:requestRoute}:{})});
    const payout=batch?batchScope():undefined;
    if(batch)await verifyFamilyBatchPayout(provider,payout,d.pool,d.poolCodehash,block.number);
    let prequote=await post('prequote',prequoteBody(initial));
    const membership=await registry.resolveMembership({asset,basePartnerId:BigInt(prequote.partnerHandleId),operation,relation:'combined'});
    const n=BigInt(amountAtomic),protocol=(n*BigInt(policy.rates[operation])+9999n)/10000n,partner=(n*BigInt(membership.feeBps)+9999n)/10000n,
     protocolDue=protocol>BigInt(prequote.minimumProtocolFee)?protocol:BigInt(prequote.minimumProtocolFee),partnerDue=partner>membership.feeMinimum?partner:membership.feeMinimum;
    if(partnerDue>membership.feeMaximum)fail('Transfer exceeds the registered partner fee range.');
    const gasDue=BigInt(gas.gasReserveAtomic),selected=selectFamilyPrivateSendNotes(recovered,blocked,n+protocolDue+partnerDue+gasDue+(operation===1?1n:2n),gas.width);if(!selected)fail('Insufficient unlocked private balance for the payment, fees, gas reserve and minimum private change.');
    if(selected.width!==gas.width||prequote.relayWallet!==gas.relayWallet||prequote.gasReserveAtomic!==gas.gasReserveAtomic)fail('The input width or gas reserve changed. Review the fees again.');
    if(selected.source.epoch!==Number(prequote.sourceEpoch)||selected.width!==prequote.width)
     prequote=await post('prequote',prequoteBody(selected));
    if(routed)for(const key of Object.keys(requestRoute))if(prequote.route?.[key]!==requestRoute[key])fail('Route authorization changed the requested limits or recipient.');
    if(expectedReview)assertFamilyReviewedFees(expectedReview,{amountAtomic,protocolFeeAtomic:protocolDue.toString(),partnerFeeAtomic:partnerDue.toString(),gasReserveAtomic:gasDue.toString(),totalDebitAtomic:(n+protocolDue+partnerDue+gasDue).toString(),feePolicyHash:policy.policyHash,partnerId:membership.partnerId,policyVersion:membership.version.toString(),receiverCommitment:membership.receiverCommitment.toString(),authorizationKey:membership.authorizationKey.toString()});
    const plan=await (routed?prepareFamilyRoutedPlan:operation===0?prepareFamilyWithdrawalPlan:prepareFamilyPrivateSendPlan)({wallet,funding,delivery,domain,selected,inventory:recovered,membership,protocolPolicy:policy,prequote,
     recipient:batch?prequote.withdrawal?.recipient:routed?prequote.escrow:recipient,amountAtomic,memo,
     relayerWallet:batch?payout.gateway:routed?transactionTarget:prequote.relayWallet,operation,route:prequote.route,signal});
    if(batch){validateFamilyBatchPayout(payout,plan.q,batch);plan.review.payments=payments;}
    if(expectedReview.grossAmountAtomic!==undefined)plan.review.grossAmountAtomic=expectedReview.grossAmountAtomic;
    if(routed)validateFamilyRoute({routes,route:plan.route,q:plan.q,payer:prequote.relayWallet,operation});
    const destinationAnchor=operation===5?await bridgeMonitor().anchor():undefined;
    id='send_'+hexlify(randomBytes(32)).slice(2);const nullifiers=selected.notes.map(n=>n.nullifier);
    await fences.reserve({id,nullifiers});reserved=true;
    await store.transact(namespace,list=>{if(list.length>=256)fail('Private transfer journal is full.');return {next:[...list,safe({schema:'stealthos-family-private-send-v2',id,pool:d.pool,generationId:r.generationId,relayWallet:prequote.relayWallet,prequoteToken:prequote.token,
     phase:'proving',q:plan.q,review:plan.review,...(batch?{batch}:{}),...(routed?{route:plan.route}:{}),...(input.privateOutput?{privateOutput:input.privateOutput}:{}),...(destinationAnchor?{destinationAnchor}:{}),nullifiers,anchorBlock:block.number})],result:undefined};});saved=true;
    const signed=await post('quote',{prequoteToken:prequote.token,quote:plan.q}),signer=(await both('feeSigner',[],block))[0];
    if(signed.digest!==plan.digest||recoverAddress(plan.digest,signed.signature).toLowerCase()!==signer.toLowerCase())fail('Fee signature differs from the deployed pool signer.');
    const canonical=(await both('normalQuoteDigest',[plan.q],block))[0];if(canonical!==plan.digest)fail('Fee quote digest differs from the pool.');
    const poolCalldata=await (routed?proveFamilyRoutedPlan:operation===0?proveFamilyWithdrawalPlan:proveFamilyPrivateSendPlan)({wallet,funding,proofRuntime:proofs,registry,plan,inventory:recovered,signature:signed.signature,assertAuthority:live,signal}),
     calldata=batch?encodeFamilyBatchPayout(payout,plan.q,batch,poolCalldata):routed?encodeFamilyRoutedCall({routes,route:plan.route,q:plan.q,payer:prequote.relayWallet,operation,poolCalldata}):poolCalldata,
     row=await set(id,r=>{if(r.phase!=='proving')fail('Preparation changed.');return {...r,calldata,calldataHash:keccak256(calldata)};});await simulate(row);
    return review(await set(id,r=>{if(r.phase!=='proving')fail('Preparation changed.');return {...r,phase:'prepared'};}));
   }catch(e){try{if(saved)await set(id,r=>r.phase==='proving'?{...r,phase:'failed'}:r);}finally{if(reserved)await fences.releaseUnsigned(id);}throw e;}finally{busy=false;}
  },
  async execute({preparedId,batch=false}){live();if(busy)fail('Another transfer is in progress.');busy=true;
   let unsigned;
   try{await enabled();let row=await read(preparedId);if(Boolean(row.batch)!==batch||row.phase!=='prepared')fail('Reconcile the saved transfer before retrying.');
    unsigned=row;
    if(row.schema!=='stealthos-family-private-send-v2')fail('Cancel this earlier wallet-paid review and review a new relayed transaction.');
    if(!row.batch)await simulate(row);
    if(await approvePrivateSend(review(row))!==true)fail('Transfer approval declined.');
    live();await simulate(row);
    await fences.armForSubmission(preparedId);unsigned=null;row=await set(preparedId,r=>({...r,phase:'submitting'}));
    const sent=await post('submit',{prequoteToken:row.prequoteToken,calldata:row.calldata});
    if(!/^0x[0-9a-f]{64}$/iu.test(sent?.transactionHash??''))fail('Submission outcome is uncertain; reconcile before continuing.');
    row=await set(preparedId,r=>({...r,transactionHash:sent.transactionHash.toLowerCase()}));
    return row.batch?review(row):api.reconcile({preparedId});
   }catch(error){if(unsigned){await fences.releaseUnsigned(preparedId);await set(preparedId,r=>r.phase==='prepared'?{...r,phase:'failed'}:r);}throw error;}finally{busy=false;}},
  async reconcile({preparedId,transactionHash,batch=false}){live();let row=await read(preparedId);if(Boolean(row.batch)!==batch)fail('Saved transfer type differs.');if(terminal(row))return review(row);
   if(row.schema==='stealthos-family-private-send-v2'&&row.phase==='submitting'&&!row.transactionHash){const status=await post('status',{prequoteToken:row.prequoteToken,calldata:row.calldata});
    let hash=status.transactionHash;
    if(!hash&&status.state==='not-submitted'){
     const now=await provider.getBlock('latest');
     if(now?.timestamp<row.q.deadline-15)hash=(await post('submit',{prequoteToken:row.prequoteToken,calldata:row.calldata})).transactionHash;
    }
    if(hash){if(!word(hash))fail('Invalid relayer transaction hash.');row=await set(preparedId,r=>({...r,transactionHash:hash}));}}
   if(transactionHash!==undefined){if(!word(transactionHash)||!['submitting','included'].includes(row.phase))fail('Only a submitted transfer can recover a transaction hash.');
    row=await set(preparedId,r=>({...r,transactionHash}));}
   const block=await anchor();
   if((await both('usedNonce',[row.q.nonce],block))[0]===true){
    // Recover wallet replacements or a send whose RPC response was lost.
    // No retransmission occurs, and only the exact saved calldata may settle.
    let from=row.scanBlock??row.anchorBlock;
    if(row.scanAnchor){const [a,b]=await Promise.all([provider.getBlock(row.scanAnchor.number),verificationProvider.getBlock(row.scanAnchor.number)]);
     if(a?.hash!==row.scanAnchor.hash||b?.hash!==row.scanAnchor.hash)from=row.anchorBlock;}
    for(let page=0;from<=block.number&&page<32;page++,from+=2048){
     const filter={address:d.pool,fromBlock:from,toBlock:Math.min(from+2047,block.number),topics:[ABI.getEvent('PreAuditNormalSettlement').topicHash,row.q.nonce]},
      [a,b]=await Promise.all([provider.getLogs(filter),verificationProvider.getLogs(filter)]),
      normalize=logs=>JSON.stringify(logs.map(l=>[l.address,l.blockNumber,l.blockHash,l.transactionHash,l.topics,l.data,l.removed===true]));
     live();if(a.length>1||b.length>1||normalize(a)!==normalize(b))fail('Canonical transfer events disagree.');
     if(a.length){const event=a[0];if(event.removed||!word(event.transactionHash))fail('Invalid canonical transfer event.');
      row=await set(preparedId,r=>({...r,transactionHash:event.transactionHash}));break;}
     row=await set(preparedId,r=>({...r,scanBlock:Math.min(from+2048,block.number+1),scanAnchor:{number:block.number,hash:block.hash}}));
    }
   }
   if(row.transactionHash){const [tx,other,receipt,independent]=await Promise.all([provider.getTransaction(row.transactionHash),verificationProvider.getTransaction(row.transactionHash),provider.getTransactionReceipt(row.transactionHash),verificationProvider.getTransactionReceipt(row.transactionHash)]);
    if(tx&&other&&(tx.hash.toLowerCase()!==row.transactionHash||other.hash.toLowerCase()!==row.transactionHash||
     BigInt(tx.chainId)!==BigInt(domain.chainId)||BigInt(other.chainId)!==BigInt(domain.chainId)||
     tx.data!==row.calldata||other.data!==row.calldata||tx.to?.toLowerCase()!==targetFor(row)||other.to?.toLowerCase()!==targetFor(row)||
     tx.from.toLowerCase()!==(row.relayWallet??payer)||other.from.toLowerCase()!==(row.relayWallet??payer)||tx.value!==(routed?BigInt(row.route.maximumDeliveryFee):0n)||other.value!==(routed?BigInt(row.route.maximumDeliveryFee):0n)))fail('Saved transaction differs.');
    if(tx&&other&&receipt&&independent&&receipt.blockNumber<=block.number&&receipt.blockHash===independent.blockHash&&receipt.status===independent.status){
     const [a,b]=await Promise.all([provider.getBlock(receipt.blockNumber),verificationProvider.getBlock(receipt.blockNumber)]);
     if(a?.hash!==receipt.blockHash||b?.hash!==receipt.blockHash)fail('Saved transaction is not canonical.');
     if(receipt.status===1){for(const nf of row.nullifiers)if((await both('nullifierSpent',[nf],block))[0]!==true)fail('Finalized transfer did not consume its inputs.');
      if(row.batch){
       const scope=batchScope(),topic=familyBatchPayoutAbi.getEvent('BatchPaid').topicHash;
       const events=receipt.logs.filter(l=>l.address.toLowerCase()===scope.gateway&&l.topics[0]===topic);
       const canonical=independent.logs.filter(l=>l.address.toLowerCase()===scope.gateway&&l.topics[0]===topic);
       if(events.length!==1||canonical.length!==1||events[0].data!==canonical[0].data||
        JSON.stringify(events[0].topics)!==JSON.stringify(canonical[0].topics))fail('Finalized batch event differs.');
       const event=familyBatchPayoutAbi.parseLog(events[0]).args;
       if(event.quoteNonce!==row.q.nonce||event.batchHash!==familyBatchPayoutHash(scope,row.q,row.batch)||
        event.pool.toLowerCase()!==d.pool||event.total!==BigInt(row.q.payout))fail('Finalized batch payout differs.');
      }
      if(routed){const events=receipt.logs.filter(l=>l.address.toLowerCase()===targetFor(row)&&l.topics[0]===familyRoutedAbi.getEvent('RoutedSettlement').topicHash);
       if(events.length!==1)fail('Finalized route event is missing or ambiguous.');const e=familyRoutedAbi.parseLog(events[0]).args;
       if(e.quoteNonce!==row.q.nonce||e.routeHash!==familyRouteHash(targetFor(row),row.route)||e.sourcePool.toLowerCase()!==d.pool||Number(e.operation)!==operation||
        e.receiver.toLowerCase()!==row.route.receiver||e.inputAmount!==BigInt(row.route.amount)||e.outputAmount<BigInt(row.route.minimumOutput)||
        e.deliveryFee>BigInt(row.route.maximumDeliveryFee)||(operation===5?BigInt(e.messageId)===0n:BigInt(e.messageId)!==0n))fail('Finalized route outcome differs.');
       row=await set(preparedId,r=>({...r,messageId:e.messageId,deliveryFeeAtomic:e.deliveryFee.toString(),outputAmountAtomic:e.outputAmount.toString(),sourceBlock:receipt.blockNumber}));
      }
     }
     row=await set(preparedId,r=>({...r,phase:receipt.status===1?'finalized':'failed-finalized'}));await fences.finish(preparedId);return review(row);}
   }
   const [latest,other]=await Promise.all([provider.getBlock('latest'),verificationProvider.getBlock('latest')]);
   if(block.timestamp>row.q.deadline&&Math.min(latest.timestamp,other.timestamp)>row.q.deadline&&(await both('usedNonce',[row.q.nonce],block))[0]===false){
    for(const nf of row.nullifiers)if((await both('nullifierSpent',[nf],block))[0]!==false)fail('An input was consumed; recover its canonical transaction.');
    row=await set(preparedId,r=>({...r,phase:'expired-unused'}));await fences.finish(preparedId);}
   return review(row);
  },
  async monitorDelivery({preparedId}){live();let row=await read(preparedId);
   if(operation!==5||row.phase!=='finalized'||!row.messageId)fail('Finalize the bridge source transaction before checking destination delivery.');
   const delivery=await bridgeMonitor().monitor({messageId:row.messageId,receiver:row.route.receiver,amountAtomic:row.route.amount,
    start:row.destinationAnchor,scanBlock:row.delivery?.scanBlock,scanAnchor:row.delivery?.scanAnchor});live();row=await set(preparedId,r=>({...r,delivery}));return review(row);},
  async cancel({preparedId}){live();const row=await read(preparedId);if(!['prepared','failed'].includes(row.phase))fail('A submitted transfer cannot be cancelled.');
   await fences.releaseUnsigned(preparedId);return review(await set(preparedId,r=>({...r,phase:'cancelled'})));},
  async list(){live();return Object.freeze((await rows()).map(review));},
  async privateOutputRuntime(){live();if(operation!==4)fail('Not a swap runtime.');return {resources:r,engine:await funding.noteEngine(),rowKeys:(start,count)=>funding.rowKeys(start,count)};},
  async privateOutputAuthority({preparedId}){
   live();const row=await read(preparedId);if(operation!==4)fail('Not a swap runtime.');
   if(!row.privateOutput)return Object.freeze({privateOutput:null,sourcePhase:row.phase});
   return Object.freeze({privateOutput:structuredClone(row.privateOutput),prequoteToken:row.prequoteToken,calldata:row.calldata,
    transactionHash:row.transactionHash??null,relayWallet:row.relayWallet,outputAmountAtomic:row.outputAmountAtomic??null,sourcePhase:row.phase,sourceBlock:row.sourceBlock,route:structuredClone(row.route)});
  },
  dispose(){closed=true;quotes.clear();registry.dispose();proofs.dispose();funding.dispose();deliveryMonitor?.dispose();}
 };return Object.freeze(api);
 }catch(e){registry?.dispose();proofs?.dispose();funding.dispose();deliveryMonitor?.dispose();throw e;}
}
