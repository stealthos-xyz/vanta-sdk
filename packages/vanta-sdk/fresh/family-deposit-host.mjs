import {VANTA_POLICY_REGISTRY_ABI as POLICY,vantaPolicyPoseidon} from './partner-policy-kzg.mjs';
import {matchesReviewedDepositPolicy} from './family-deposit-approval.mjs';
import {depositFailure,depositWalletSubmissionCode,uncertainDepositSubmission} from './family-deposit-errors.mjs';
import {createVantaFamilyPartnerAssetConfiguration} from './family-partner-app-config.mjs';
/** Current compiled-family deposit composition. No caller selects proof keys,
 * circuits, routes, pool addresses or fee policy. All private notes stay local. */
import {Interface,getAddress,keccak256,randomBytes,hexlify,toUtf8Bytes} from "ethers";
import {getCompiledFamilyEvmRelease,verifyCompiledFamilyOperationRuntime,isFamilyWithdrawalOnlyContext} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources} from "./family-proof-resources.mjs";
import {selectVantaFamilyFundingResources} from "./family-funding-resources.mjs";
import {createVantaFamilyProofRuntime} from "./family-proof-runtime.mjs";
import {createVantaFamilyPartnerRegistry} from "./family-partner-registry.mjs";
import {createVantaEnhancedFundingRuntime} from "./family-enhanced-funding-runtime.mjs";
import {createFamilyNoteDelivery} from "./family-note-delivery.mjs";
import {resolveFamilyDepositRoute,normalizeFreshHandle} from "./family-deposit-route.mjs";
import {buildDirectFamilyDepositIntent} from './family-direct-deposit.mjs';
import {requireNativeWalletClearance} from './family-native-clearance.mjs';
import {createFamilyDepositJournal} from "./family-deposit-journal.mjs";
import {encodeVantaFamilyReceivingAddress,decodeVantaFamilyReceivingAddress} from './family-normal-address.mjs';
import {reconcileFamilyDepositReceipt} from './family-public-payment-receipt.mjs';
import {DEPOSIT_FIELD as FR,DEPOSIT_ZERO as ZERO,depositWord as word,depositAmount,depositPoolAbi as ABI,
 depositCoder as coder,depositPublicSignals,assertFamilyDepositProof,depositFeeTerms,depositTransactionDigest,directDepositNonceMethod} from "./family-deposit-wire.mjs";
const address=v=>getAddress(v).toLowerCase(),same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const json=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x));
const fail=message=>{throw Error("Family deposit: "+message);};
const hash=v=>{if(!/^0x[0-9a-f]{64}$/u.test(v??""))fail("invalid hash");return v;};
const zeroRow=Object.freeze({a:{x:"0",y:"0"},u:{x:"0",y:"0"},aCompressed:ZERO,uCompressed:ZERO,siblings:Array(16).fill(ZERO)});
const ADAPTER=new Interface(["function registry() view returns(address)","function protocolCollectorCommitment() view returns(uint256)",
 "function releaseSetupId() view returns(bytes32)","function releaseGenerationId() view returns(bytes32)",
 "function releaseFamilyTag() view returns(bytes32)","function releaseChainId() view returns(uint256)"]);
const TOKEN=new Interface(["function allowance(address,address) view returns(uint256)","function balanceOf(address) view returns(uint256)"]);
const now=()=>Math.floor(Date.now()/1000);

export async function createVantaFamilyDepositHost({walletController,store,provider,verificationProvider,artifactBaseUrl,
 relayerUrl,fetcher,signal,onProgress,asset="native",walletAddress,getSession,approveDeposit,submitTransaction,releaseContext,partnerAssetConfiguration,paymentRecipient}={}){
 if((paymentRecipient===undefined&&typeof walletController?.requireWallet!=="function")||!provider||!verificationProvider||provider===verificationProvider||
  [getSession,approveDeposit,submitTransaction].some(f=>typeof f!=="function"))fail("trusted host callbacks and two RPCs required");
 if(isFamilyWithdrawalOnlyContext(releaseContext))fail("Historical generations accept withdrawals only.");
 const release=getCompiledFamilyEvmRelease(releaseContext),inventory=getCompiledVantaFamilyProofResources(release,releaseContext);
 const resources=selectVantaFamilyFundingResources(release,inventory,asset),d=resources.deployment,payer=address(walletAddress);
 const nonceMethod=directDepositNonceMethod(d);
 const publicRecipient=paymentRecipient===undefined?null:decodeVantaFamilyReceivingAddress(encodeVantaFamilyReceivingAddress(paymentRecipient));
 if(publicRecipient){for(const [key,value]of Object.entries({chainId:resources.chainId,familyTag:resources.familyTag,genesisHash:resources.genesisHash,generationId:resources.generationId,setupId:d.setupId,pool:d.pool,asset:d.asset}))
  if(publicRecipient[key]!==value)fail('payment recipient belongs to a different network, generation, pool or asset');}
 const recipientAddress=publicRecipient?encodeVantaFamilyReceivingAddress(publicRecipient):undefined;
 const appAssets=partnerAssetConfiguration?createVantaFamilyPartnerAssetConfiguration({...partnerAssetConfiguration,provider,verificationProvider,releaseContext,fetcher:fetcher??fetch}):null;
 const enabled=async()=>{if(appAssets){await appAssets.refresh();appAssets.requireAsset(d.asset,{operation:'deposit'});}};
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
 let proofs,registry,funding,delivery,closed=false,busy=false;
 const quotes=new Map();
 const live=()=>{controller.signal.throwIfAborted();if(closed)fail("host is closed");};
 const wallet=publicRecipient?null:walletController.requireWallet(),session=amount=>{
  live();if(!publicRecipient&&walletController.requireWallet()!==wallet)fail("wallet changed");
  const s=getSession();if(!s||!Array.isArray(s.permissions)||!s.permissions.includes("deposit")||
   !Number.isSafeInteger(s.expiresAt)||s.expiresAt<=now()||!/^[-_A-Za-z0-9]{1,128}$/u.test(s.subjectId??"")||
   !/^[-_A-Za-z0-9]{1,128}$/u.test(s.sessionId??"")||
   !/^[1-9][0-9]{0,36}$/u.test(s.maximumDebitAtomic??"")||!/^[1-9][0-9]{0,36}$/u.test(s.maximumSessionDebitAtomic??"")||
   amount!==undefined&&BigInt(amount)>BigInt(s.maximumDebitAtomic))fail("deposit session is unavailable or over budget");
  return json(s);
 };
 const stableSession=(expected,amount)=>{if(JSON.stringify(session(amount))!==JSON.stringify(expected))fail("deposit authority changed");};
 const dispose=()=>{closed=true;quotes.clear();abort();proofs?.dispose();registry?.dispose();funding?.dispose();signal?.removeEventListener("abort",abort);};
 const journal=createFamilyDepositJournal({store,networkId:release.pins.networkId,generationId:resources.generationId,pool:d.pool});
 const anchored=async()=>{
  live();const [a,b]=await Promise.all([provider.getBlock("latest"),verificationProvider.getBlock("latest")]);
  const height=Math.min(a?.number,b?.number);
  if(!Number.isSafeInteger(height)||height<d.deploymentBlock)fail("no current common block");
  const [x,y]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
  if(!x?.hash||!same(x.hash,y?.hash)||x.timestamp!==y.timestamp)fail("RPC block disagreement");
  return x;
 };
 const both=async(to,abi,method,args,block)=>{
  const tx={to,data:abi.encodeFunctionData(method,args??[]),blockTag:block.number};
  const [a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
  if(!same(a,b))fail("independent contract reads disagree");return abi.decodeFunctionResult(method,a);
 };
 const stable=async block=>{const [a,b]=await Promise.all([provider.getBlock(block.number),verificationProvider.getBlock(block.number)]);
  if(!same(a?.hash,block.hash)||!same(b?.hash,block.hash))fail("canonical block changed");live();};
 const pinCode=async(addr,block)=>{
  const pin=release.lock.contracts.find(row=>same(row.address,addr));if(!pin)fail("contract absent from signed deployment lock");
  const [a,b]=await Promise.all([provider.getCode(addr,block.number),verificationProvider.getCode(addr,block.number)]);
  if(a==="0x"||b==="0x"||!same(keccak256(a),pin.codehash)||!same(keccak256(b),pin.codehash))fail("runtime code changed");
 };
 const poolState=async()=>{
  await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,d.pool,releaseContext,['native-screening-clearance'])));
  const block=await anchored();await pinCode(d.pool,block);
  const gates=release.lock.contracts.filter(row=>row.name==='native-screening-clearance');
  if(gates.length!==1)fail('This signed generation does not support direct deposits.');
  const clearance=address(gates[0].address);await pinCode(clearance,block);
  const values=Object.fromEntries(await Promise.all(["asset","feeSigner","feePolicyHash","protocolFeeRecipient","partnerFeeRecipient","combinedFeePartnerVerifier"].map(async method=>[method,(await both(d.pool,ABI,method,[],block))[0]])));
  if(address(values.asset)!==d.asset)fail("signed custody asset differs");
  const adapter=address(values.combinedFeePartnerVerifier);await pinCode(adapter,block);
  await Promise.all([["releaseSetupId",d.setupId],["releaseGenerationId",resources.generationId],["releaseFamilyTag",resources.familyTag],["releaseChainId",resources.chainId]].map(async([method,value])=>{
   if(BigInt((await both(adapter,ADAPTER,method,[],block))[0])!==BigInt(value))fail("deposit adapter activation differs");
  }));
  const registered=address((await both(adapter,ADAPTER,"registry",[],block))[0]);
  const role=release.lock.contracts.filter(v=>v.name==="partner-registry");
  if(role.length!==1||address(role[0].address)!==registered)fail("unapproved deposit registry");
  await stable(block);
  return {block,adapter,clearance,registry:registered,protocolCommitment:(await both(adapter,ADAPTER,"protocolCollectorCommitment",[],block))[0],
   fee:{signer:address(values.feeSigner),policyHash:values.feePolicyHash.toLowerCase(),
    protocolRecipient:address(values.protocolFeeRecipient),partnerRecipient:address(values.partnerFeeRecipient)}};
 };
 const simulate=async record=>{
  const block=await anchored();await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,d.pool,releaseContext,['native-screening-clearance'])));
  await pinCode(d.pool,block);
  if(record.deadline<=block.timestamp+30)fail("deposit quote expires too soon");
  const q=record.plan.quote,source=await both(d.pool,ABI,"currentSource",[],block);
  if(BigInt(source.epoch)!==BigInt(q.epoch)||BigInt(source.checkpoint)!==BigInt(q.checkpoint)||Number(source.rows)!==record.plan.rowStart)fail("deposit source moved; prepare again");
  if((await both(d.pool,ABI,nonceMethod,[q.nonce],block))[0])fail("deposit quote nonce is already consumed");
  if(BigInt(d.asset)!==0n){
   await pinCode(d.asset,block);
   for(const [method,args] of [["allowance",[payer,d.pool]],["balanceOf",[payer]]])
    if((await both(d.asset,TOKEN,method,args,block))[0]<BigInt(record.amountAtomic))fail("token balance or allowance is insufficient");
  }
  const tx={...record.transaction,blockTag:block.number,gasLimit:10_000_000};
  delete tx.chainId;
  const [a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);if(!same(a,b))fail("deposit simulations disagree");
  await stable(block);
 };
 try{
  proofs=await createVantaFamilyProofRuntime({provider,artifactBaseUrl,fetcher,signal:controller.signal,releaseContext,onProgress});
  registry=await createVantaFamilyPartnerRegistry({provider,verificationProvider,artifactBaseUrl,proofRuntime:proofs,fetcher,signal:controller.signal,releaseContext});
  funding=await createVantaEnhancedFundingRuntime({artifactBaseUrl,fetcher,signal:controller.signal,releaseContext,onProgress,asset});
  const native=resources.profiles.normal8.runtime,domain={schema:"vanta-family-note-domain-v1",safeForFunds:false,
   chainId:resources.chainId,familyTag:resources.familyTag,genesisHash:resources.genesisHash,generationId:resources.generationId,
   setupId:d.setupId,pool:d.pool,asset:d.asset,poolCodehash:d.poolCodehash,nativeGlueSha256:native.glue.sha256,nativeWasmSha256:native.wasm.sha256};
  delivery=createFamilyNoteDelivery({domain,engine:await funding.noteEngine()});
  const recipient=route=>({schema:"vanta-family-note-recipient-v1",chainId:domain.chainId,familyTag:domain.familyTag,
   genesisHash:domain.genesisHash,generationId:domain.generationId,setupId:domain.setupId,pool:domain.pool,asset:domain.asset,
   masterPublicKey:word(route.collectorMpk),viewingPublicKey:route.viewingPublicKey});
  const review=r=>Object.freeze({preparedId:r.preparedId,networkId:release.pins.networkId,generationId:resources.generationId,
   pool:d.pool,asset:d.asset,assetSymbol:d.assetSymbol,payer,amountAtomic:r.amountAtomic,protocolFeeAtomic:"0",
   partnerFeeAtomic:r.plan.quote.partnerFeeCap,netAmountAtomic:r.plan.ownedNote.amount_units,
   deadline:r.deadline,transactionDigest:r.transactionDigest,phase:r.phase,...(recipientAddress?{recipient:recipientAddress}:{}),
   ...(["insufficient-funds","user-rejected","submission-rejected"].includes(r.failure)?{failure:r.failure}:{})});
  const prepareDeposit=async({amountAtomic,partnerHandle}={},expectedQuote)=>{
    if(busy)fail("another deposit is running");busy=true;let stage="Wallet session";
    try{
     const gross=depositAmount(amountAtomic),authority=session(amountAtomic);
     stage="Supported asset";await enabled();stage="Pool bindings";const state=await poolState(),common={release,resources,asset,provider,verificationProvider,relayerUrl,fetcher,signal:controller.signal};
     stage="Receiving routes";const [protocol,partner]=await Promise.all([resolveFamilyDepositRoute({...common,handle:"protocol.stealth"}),resolveFamilyDepositRoute({...common,handle:partnerHandle})]);
     stage="Partner fee policy";const membership=await registry.resolveMembership({asset,basePartnerId:BigInt(partner.handleId),operation:2,relation:"combined"});
     if(address(membership.pool)!==d.pool||address(membership.asset)!==d.asset||membership.operation!==2||
      membership.receiverCommitment!==partner.receiverCommitment||membership.authorizationKey!==partner.authorizationCommitment||
      protocol.feeCollectorProofCommitment!==state.protocolCommitment)fail("partner policy or collector binding differs");
     let partnerFee=(gross*BigInt(membership.feeBps)+9999n)/10000n;
     if(partnerFee<membership.feeMinimum)partnerFee=membership.feeMinimum;
     if(partnerFee>membership.feeMaximum||partnerFee>=gross)fail("partner deposit fee exceeds its policy or leaves no owned value");

     if(expectedQuote&&!matchesReviewedDepositPolicy(expectedQuote,membership,partnerFee,now()))
      fail('Partner deposit fees or receiving policy changed. Review the deposit again.');
     stage="Private note encryption";const owned=publicRecipient?delivery.createRecipientNote({recipient:publicRecipient,amountAtomic:(gross-partnerFee).toString()}):await delivery.createOwnedNote({wallet,amountAtomic:(gross-partnerFee).toString()});
     const protocolNote=delivery.createRecipientNote({recipient:recipient(protocol),amountAtomic:"0"});
     const partnerNote=delivery.createRecipientNote({recipient:recipient(partner),amountAtomic:partnerFee.toString()});
     const notes=[owned,protocolNote,partnerNote],outputs=[...notes.map(n=>n.commitment),ZERO,ZERO];
     const encryptedOutputs=[await delivery.encrypt({recipient:publicRecipient||await delivery.walletRecipient(wallet),note:owned}),
      await delivery.encrypt({recipient:recipient(protocol),note:protocolNote}),await delivery.encrypt({recipient:recipient(partner),note:partnerNote}),"0x","0x"];
     let blinding=BigInt(hexlify(randomBytes(48)))%FR;if(blinding===0n)fail("invalid random blinding");
     const terms=await depositFeeTerms({domain,feePolicyHash:state.fee.policyHash,tokenHash:delivery.tokenHash,
      protocolRoute:protocol,partnerRoute:partner,outputs,blinding,partnerFee});
     const draft={asset:d.assetSymbol,payer,count:3,gross,protocolFeeCap:0n,partnerFeeCap:partnerFee,
      outputsHash:keccak256(coder.encode(["uint256[5]"],[outputs])),
      envelopesHash:keccak256(coder.encode(["bytes32[5]"],[[...encryptedOutputs.slice(0,3).map(keccak256),ZERO,ZERO]])),
      feeSlotsHash:keccak256(coder.encode(["uint8[2]"],[[1,2]])),feeTermsHash:BigInt(terms),partnerRegistryRoot:membership.root};
     stableSession(authority,amountAtomic);
     stage="Native wallet screening";const clearance=await requireNativeWalletClearance({release,payer,verifier:state.clearance,timestamp:state.block.timestamp,
      read:(to,abi,method,args)=>both(to,abi,method,args,state.block),serviceUrl:relayerUrl,fetcher:fetcher??fetch,signal:controller.signal});
     stage="Deposit intent";const intentSource=await both(d.pool,ABI,'currentSource',[],state.block);
     const signed=await buildDirectFamilyDepositIntent({chainId:resources.chainId,pool:d.pool,asset:d.asset,fee:state.fee,draft,source:intentSource,
      partnerId:membership.partnerId,timestamp:state.block.timestamp,validUntil:clearance.validUntil});
     if(!same((await both(d.pool,ABI,'privateDepositQuoteDigest',[signed.quote],state.block))[0],signed.digest))fail('Local deposit intent domain differs.');
     stableSession(authority,amountAtomic);
     const fee={schema:"vanta-v8-unified-private-fee-witness-v1",chain_id:domain.chainId,pool:d.pool,asset:d.asset,
      fee_policy_hash:state.fee.policyHash,minimum_protocol_fee_units:"0",fee_caps_units:["0",partnerFee.toString(),"0"],
      collector_mpks:[word(protocol.collectorMpk),word(partner.collectorMpk),ZERO],collector_salts:[word(protocol.receiverSalt),ZERO],
      fee_slots:[1,2,5],mode:2,width:0,gross_deposit_units:amountAtomic,
      outputs:notes.map((n,i)=>({npk:n.npk,value_units:n.amount_units,random:i===0?ZERO:n.random})),
      terms_blinding:word(blinding),signed_quote_digest:signed.digest,expected_fee_terms_hash:terms};
     const witness=registry.bindCombinedWitness({membership,fee,partner:{
      signed_quote_digest:signed.digest,signed_partner_nonce:signed.quote.nonce,partner_output_commitment:partnerNote.commitment,
      private_fee_terms_hash:terms,mode:2,width:0,gross_deposit_units:amountAtomic,amount_hash:ZERO,batch_digest:ZERO,
      fee_leg_index:0,collector_mpk:word(partner.collectorMpk),receiver_salt:word(partner.receiverSalt),quote_nonce_salt:signed.walletPartnerNonceSalt,
      fee_note_random:partnerNote.random,fee_note_amount_units:partnerFee.toString(),reference_amount_units:amountAtomic,amount_salt:ZERO}});
     const expected=depositPublicSignals({domain,quote:signed.quote,digest:signed.digest,outputs,tokenHash:delivery.tokenHash,
      protocolCommitment:state.protocolCommitment,registry:membership.registry,policyContext:membership.policyContext});
     stage="Proof generation";const proof=assertFamilyDepositProof(await proofs.proveDeposit({request:{walletWitness:witness,expectedPublicSignals:expected},signal:controller.signal}),expected);
     stableSession(authority,amountAtomic);
     const block=await anchored(),source=await both(d.pool,ABI,"currentSource",[],block),rowStart=Number(source.rows);
     if(BigInt(source.epoch)!==signed.quote.epoch||BigInt(source.checkpoint)!==signed.quote.checkpoint||rowStart<32||rowStart+3>65536)fail("deposit source moved");
     stage="Append keys";const keys=await funding.rowKeys(rowStart,3);if(keys.length!==3)fail("deposit needs exactly three authenticated append keys");
     const rowKeys=[...keys,zeroRow,zeroRow],calldata=ABI.encodeFunctionData("depositWithPrivateFeeNotes",
      [signed.quote,outputs,encryptedOutputs,rowKeys,[1,2],proof,clearance.encoded]).toLowerCase();
     stage="Recovery verification";
     if(publicRecipient)delivery.verifyRecipientNote({recipient:publicRecipient,note:owned});
     else{const restored=await delivery.decrypt({wallet,envelope:encryptedOutputs[0],commitment:owned.commitment});
      if(!restored||Object.keys(restored.note).length!==Object.keys(owned).length||Object.keys(owned).some(k=>restored.note[k]!==owned[k]))fail("owned note cannot be recovered");}
     const transaction={chainId:domain.chainId,from:payer,to:d.pool,data:calldata,value:BigInt(d.asset)===0n?"0x"+gross.toString(16):"0x0"};
     const record={preparedId:hexlify(randomBytes(32)),quoteNonce:signed.quote.nonce.toLowerCase(),amountAtomic,
      deadline:Number(signed.quote.deadline),session:authority,transaction,transactionDigest:depositTransactionDigest(transaction),preparedAtBlock:block.number,...(recipientAddress?{paymentRecipient:recipientAddress}:{}),
      plan:json({quote:signed.quote,rowStart,outputs,encryptedOutputs,ownedNote:owned})};
     stage="Contract simulation";await simulate(record);stableSession(authority,amountAtomic);
     stage="Pending deposit journal";return review(await journal.reserve(record));
    }catch(error){throw depositFailure(error,stage);}finally{busy=false;}
   };
  return Object.freeze({
   warmProofRuntime:()=>proofs.warmDepositRuntime(),
   async warmWalletClearance(){
    live();const state=await poolState();return requireNativeWalletClearance({release,payer,verifier:state.clearance,
     timestamp:state.block.timestamp,read:(to,abi,method,args)=>both(to,abi,method,args,state.block),
     serviceUrl:relayerUrl,fetcher:fetcher??fetch,signal:controller.signal});
   },
   prepareDeposit,
   async quoteDeposit({amountAtomic,partnerHandle}={}){
    if(busy)fail('another deposit is running');busy=true;let stage='Wallet session';
    try{
     const gross=depositAmount(amountAtomic);session(amountAtomic);
     // Review is a public fee estimate, not deposit preparation. Authenticate
     // just its registry/asset scope here; all routes, screening, pool bindings,
     // app eligibility and proof checks remain mandatory after confirmation.
     stage='Partner fee policy';const block=await anchored(),roles=release.lock.contracts.filter(p=>p.name==='partner-registry');
     if(roles.length!==1)fail('Missing signed partner registry.');const registryAddress=address(roles[0].address);await pinCode(registryAddress,block);
     const handleId=await vantaPolicyPoseidon([BigInt(keccak256(toUtf8Bytes(normalizeFreshHandle(partnerHandle)))),BigInt(resources.chainId)]);
     const [[activePool],[partnerId]]=await Promise.all([both(registryAddress,POLICY,'activePoolForAsset',[d.asset],block),both(registryAddress,POLICY,'operationPartnerId',[handleId,2],block)]);
     if(address(activePool)!==d.pool)fail('Current deposit pool differs from the signed generation.');
     const [found,slot]=await both(registryAddress,POLICY,'partnerSlot',[d.pool,partnerId],block);
     if(!found)fail('Partner deposit policy is not registered.');
     const [row]=await both(registryAddress,POLICY,'partnerAt',[d.pool,slot],block);
     if(!row.active||!same(row.partnerId,partnerId)||row.receiverCommitment<=0n||row.authorizationKey<=0n)
      fail('Partner deposit policy is inactive.');
     let fee=(gross*row.feeBps+9999n)/10000n;if(fee<row.feeMinimum)fee=row.feeMinimum;
     if(fee>row.feeMaximum||fee>=gross)fail('Partner deposit fee exceeds its policy or leaves no owned value.');
     await stable(block);
     const quote=Object.freeze({quoteId:hexlify(randomBytes(32)),networkId:release.pins.networkId,generationId:resources.generationId,
      pool:d.pool,asset:d.asset,assetSymbol:d.assetSymbol,payer,amountAtomic,protocolFeeAtomic:'0',partnerFeeAtomic:fee.toString(),netAmountAtomic:(gross-fee).toString(),
      deadline:now()+300,partnerId:partnerId.toLowerCase(),policyVersion:row.version.toString(),receiverCommitment:row.receiverCommitment.toString(),authorizationKey:row.authorizationKey.toString(),...(recipientAddress?{recipient:recipientAddress}:{})});
     if(quotes.size>=4)quotes.delete(quotes.keys().next().value);quotes.set(quote.quoteId,{quote,partnerHandle});return quote;
    }catch(error){throw depositFailure(error,stage);}finally{busy=false;}
   },
   async prepareReviewedDeposit({quoteId}={}){
    const selected=quotes.get(quoteId);if(!selected)fail('Review the deposit before preparing its proof.');
    quotes.delete(quoteId);if(selected.quote.deadline<=now())fail('Deposit review expired. Review the deposit again.');
    return prepareDeposit({amountAtomic:selected.quote.amountAtomic,partnerHandle:selected.partnerHandle},selected.quote);
   },
   async executeDeposit({preparedId}={}){
    if(busy)fail("another deposit is running");busy=true;let stage="Supported asset";
    try{
     await enabled();stage="Pending deposit journal";const r=await journal.read(hash(preparedId));stage="Wallet session";const authority=session(r.amountAtomic);
     if(r.paymentRecipient!==recipientAddress)fail('saved payment recipient differs');
     if(r.phase!=="prepared"||r.session.subjectId!==authority.subjectId||r.session.sessionId!==authority.sessionId)fail("deposit cannot be submitted again");
     if(depositTransactionDigest(r.transaction)!==r.transactionDigest)fail("stored transaction bytes differ");
     stage="Contract simulation";await simulate(r);stableSession(authority,r.amountAtomic);
     stage="Deposit approval";if(await approveDeposit(review(r))!==true)fail("deposit approval declined");
     stableSession(authority,r.amountAtomic);stage="Contract simulation";await simulate(r);
     stage="Pending deposit journal";await journal.arm(r.preparedId,authority);
     // Ambiguous errors after this durable barrier must be reconciled.
     const barrier=await journal.read(r.preparedId);if(barrier.phase!=="broadcast-uncertain")fail("submission barrier was not durable");
     stableSession(authority,r.amountAtomic);
     stage="Wallet submission";let sent;
     try{
      sent=await submitTransaction({preparedId:r.preparedId,...r.transaction,transactionDigest:r.transactionDigest});
     }catch(error){
      const code=depositWalletSubmissionCode(error);
      if(code){
       await journal.recordRejection(r.preparedId,code);
       throw Object.assign(Error("Wallet rejected the deposit."),{code});
      }
      if(error?.code==='AUTHORIZATION_UNCERTAIN')throw error;
      throw uncertainDepositSubmission(error);
     }
     if(!/^0x[0-9a-f]{64}$/u.test(sent?.transactionHash??''))throw uncertainDepositSubmission(undefined);
     hash(sent?.transactionHash);await journal.mark(r.preparedId,"broadcast-uncertain",sent.transactionHash);
     return Object.freeze({preparedId:r.preparedId,transactionHash:sent.transactionHash,phase:"broadcast-uncertain"});
    }catch(error){throw depositFailure(error,stage);}finally{busy=false;}
   },
   async reconcileDeposit({preparedId,transactionHash}={}){
    live();const r=await journal.read(hash(preparedId));session(r.amountAtomic);
    if(r.paymentRecipient!==recipientAddress)fail('saved payment recipient differs');
    if(["finalized","failed","expired-unused"].includes(r.phase))
     return Object.freeze({...review(r),transactionHash:r.transactionHash});
    // Reconcile the exact prepared transaction and its three public outputs.
    // Never send wallet-specific note filters or replay pool balance history.
    if(depositTransactionDigest(r.transaction)!==r.transactionDigest||!same(r.quoteNonce,r.plan.quote.nonce)||
      !Number.isSafeInteger(r.preparedAtBlock)||r.preparedAtBlock<d.deploymentBlock)fail('saved deposit transaction differs');
    await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,d.pool,releaseContext,['native-screening-clearance'])));
    const result=await reconcileFamilyDepositReceipt({provider,verificationProvider,record:r,transactionHash,
     validateAnchor:async anchor=>{await pinCode(d.pool,anchor);await stable(anchor);},
     readUsedNonce:async anchor=>(await both(d.pool,ABI,nonceMethod,[r.quoteNonce],anchor))[0]});
    if(result.phase==='finalized'&&!publicRecipient){
     const restored=await delivery.decrypt({wallet,envelope:r.plan.encryptedOutputs[0],commitment:r.plan.ownedNote.commitment});
     if(!restored||Object.keys(restored.note).length!==Object.keys(r.plan.ownedNote).length||
       Object.keys(r.plan.ownedNote).some(key=>restored.note[key]!==r.plan.ownedNote[key]))fail('recovered deposit opening differs');
    }
    await stable(result.anchor);
    if(['finalized','failed','expired-unused'].includes(result.phase))await journal.mark(r.preparedId,result.phase,result.transactionHash);
    const current=await journal.read(r.preparedId);return Object.freeze({...review(current),transactionHash:current.transactionHash});
   },
   async listDepositHistory(){live();return Object.freeze((await journal.list()).filter(r=>r.paymentRecipient===recipientAddress).map(r=>Object.freeze({...review(r),transactionHash:r.transactionHash??null})));},
   async listPendingDeposits(){live();return Object.freeze((await journal.list()).filter(r=>r.paymentRecipient===recipientAddress&&!["finalized","expired-unused","failed"].includes(r.phase)).map(review));},
   dispose,
  });
 }catch(error){dispose();throw error;}
}

export {depositTransactionDigest} from "./family-deposit-wire.mjs";
