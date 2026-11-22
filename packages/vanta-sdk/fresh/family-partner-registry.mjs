import {verifyFamilyPartnerPolicyChanges} from './family-partner-receipt.mjs';
/** Shared human/agent family partner registry service. Contract roles and
 * artifact hashes come only from the signed, compiled family descriptor. */
import {AbiCoder,Interface,getAddress,keccak256} from "ethers";
import {getCompiledFamilyEvmRelease,isFamilyWithdrawalOnlyContext} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources,createVantaFamilyProofArtifactReader} from "./family-proof-resources.mjs";
import {selectVantaFamilyFundingResources} from './family-funding-resources.mjs';
import {vantaPolicyPoseidon} from "./partner-policy-kzg.mjs";
import {VANTA_POLICY_REGISTRY_ABI as REGISTRY,VANTA_POLICY_ROW_KEY_TUPLE,
  finalizedPolicyContext,policyReadBoth,readVantaPolicyTable,assertStablePolicyContext,
  authenticateVantaPolicyCorpus,prepareVantaPolicyBatch,buildVantaPolicyLookup,
  vantaPolicyLeaf,vantaPolicyOwnerAction,findVantaPolicyRecord,policyField,policyHex} from "./partner-policy-kzg.mjs";

const ZERO="0x"+"00".repeat(20),coder=AbiCoder.defaultAbiCoder(),memberships=new WeakSet();
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const FEES="tuple(uint16 feeBps,uint128 minimumFee,uint128 maximumFee)[6]";
const REGISTRAR=new Interface([
  "function registry() view returns(address)","function handleRegistry() view returns(address)",
  "function ownerVerifier() view returns(address)","function canonicalToken() view returns(address)",
  "function canonicalAssets() view returns(address[])",
  "function assetRegistrationVersion() pure returns(uint8)",
  "function registeredAssetMask(bytes32) view returns(uint8)",
  "function revokedAssetMask(bytes32) view returns(uint8)",
  "function isPartnerAssetBound(bytes32,uint8) view returns(bool)",
  `function registerPartnerAsset(bytes32 handleId,uint256 authorizationCommitment,uint256 receiverCommitment,bytes32 routingCommitment,bytes32 salt,uint8 assetIndex,${FEES} fees,uint256 checkpoint,${VANTA_POLICY_ROW_KEY_TUPLE}[6] keys,uint64 revision,uint64 deadline,uint256[8] ownershipProof,uint256 authorizationNullifier)`,
  `function updatePartnerAssetFees(bytes32 handleId,uint8 assetIndex,${FEES} fees,uint256 checkpoint,${VANTA_POLICY_ROW_KEY_TUPLE}[6] keys,uint64 revision,uint64 deadline,uint256[8] ownershipProof,uint256 authorizationNullifier)`,
  `function revokePartnerAsset(bytes32 handleId,uint8 assetIndex,uint256 checkpoint,${VANTA_POLICY_ROW_KEY_TUPLE}[6] keys,uint64 revision,uint64 deadline,uint256[8] ownershipProof,uint256 authorizationNullifier)`,
  "function releaseGenesisHash() view returns(bytes32)",
  "function isPartnerHandleBound(bytes32) view returns(bool)",
  "function partnerIdentity(bytes32) view returns(uint256 authorizationCommitment,uint256 receiverCommitment,bytes32 routingCommitment,bytes32 salt,uint64 nextRevision,bool exists)",
  `function registerPartner(bytes32 handleId,uint256 authorizationCommitment,uint256 receiverCommitment,bytes32 routingCommitment,bytes32 salt,${FEES} fees,uint256[] checkpoints,${VANTA_POLICY_ROW_KEY_TUPLE}[] keys,uint64 deadline,uint256[8] ownershipProof,uint256 authorizationNullifier)`,
  `function updateFees(bytes32 handleId,${FEES} fees,uint256[] checkpoints,${VANTA_POLICY_ROW_KEY_TUPLE}[] keys,uint64 revision,uint64 deadline,uint256[8] ownershipProof,uint256 authorizationNullifier)`,
  `function revokePartner(bytes32 handleId,uint256[] checkpoints,${VANTA_POLICY_ROW_KEY_TUPLE}[] keys,uint64 revision,uint64 deadline,uint256[8] ownershipProof,uint256 authorizationNullifier)`,
]);
const HANDLE=new Interface(["function getHandleState(bytes32) view returns(bytes32 recordCommitment,bytes32 ownerCommitment,uint64 epoch,bool exists)"]);
const OWNER=new Interface(["function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[7]) view returns(bool)"]);
const POOL=new Interface(["function asset() view returns(address)"]);
const relayNonce=(chain,registrar,calldata,kind)=>keccak256(coder.encode(
  ["string","uint256","address","bytes32"],["VANTA_FAMILY_KZG_PARTNER_"+kind.toUpperCase()+"_V1",
    chain,registrar,keccak256(calldata)]));
const intentSchema="vanta-family-kzg-partner-asset-intent-v1";
const json=value=>JSON.stringify(value,(_key,v)=>typeof v==="bigint"?{$bigint:v.toString()}:v);
const parse=value=>{
  if(typeof value!=="string"||value.length>2*1024*1024)throw Error("Invalid partner pending record size.");
  return JSON.parse(value,(_key,v)=>{
    if(v&&typeof v==="object"&&Object.keys(v).join()==="$bigint"){
      if(typeof v.$bigint!=="string"||!/^(0|[1-9][0-9]{0,77})$/u.test(v.$bigint))
        throw Error("Invalid partner pending integer.");
      return BigInt(v.$bigint);
    }
    return v;
  });
};
function fees(value){
  if(!Array.isArray(value)||value.length!==6)throw Error("Family partner needs all six operation fees.");
  return Object.freeze(value.map((f,operation)=>{
    if(!f||!Number.isInteger(f.feeBps)||f.feeBps<0||f.feeBps>10_000||
       typeof f.minimumFee!=="bigint"||typeof f.maximumFee!=="bigint"||f.minimumFee<0n||
       f.maximumFee<f.minimumFee||f.maximumFee>=(1n<<120n)||
       (f.feeBps===0?f.minimumFee!==f.maximumFee:f.maximumFee===0n))
      throw Error("Family partner fee violates its exact bounds.");
    return Object.freeze({feeBps:f.feeBps,minimumFee:f.minimumFee,maximumFee:f.maximumFee});
  }));
}
function requiredRole(release,name){
  const rows=release.lock.contracts.filter(row=>row.name===name);
  if(rows.length!==1)throw Error("Missing or duplicate signed family role: "+name);
  return rows[0];
}
/** Fee-policy reads need the policy contracts and selected custody pool, not
 * every unrelated verifier/pool in the release. Explicit release audits retain
 * the complete lock. Pins still come exclusively from the signed inventory. */
export function familyPolicyDeploymentPins(release,inventory,profile,assetIndex){
  if(assetIndex!==undefined&&(!Number.isInteger(assetIndex)||!inventory.funding.pools[assetIndex]))
    throw Error('Invalid selected policy asset.');
  const roles=['partner-registry','partner-registrar','handle-registry','partner-owner'].map(name=>requiredRole(release,name));
  const addresses=new Set([...roles.map(row=>row.address),...Object.values(profile.verifiers).map(row=>row.address),
    ...inventory.funding.pools.filter((_,index)=>assetIndex===undefined||index===assetIndex).map(row=>row.pool)].map(value=>getAddress(value).toLowerCase()));
  const pins=release.lock.contracts.filter(row=>addresses.has(getAddress(row.address).toLowerCase()));
  if(pins.length!==addresses.size)throw Error('Missing or duplicate signed policy dependency.');
  return pins;
}
/** A compiled activation is still mandatory. Constructing this service cannot
 * activate a network, import an old generation or select unreviewed artifacts. */
export async function createVantaFamilyPartnerRegistry({provider,verificationProvider,
  artifactBaseUrl,proofRuntime,fetcher,signal,releaseContext}={}){
  const release=getCompiledFamilyEvmRelease(releaseContext),inventory=getCompiledVantaFamilyProofResources(release,releaseContext);
  // Construction is local. context() below authenticates the live registrar,
  // registry, handle and owner bindings before policy reads or mutations.
  const profile=inventory.partnerPolicyKzg,registry=requiredRole(release,"partner-registry"),
    registrar=requiredRole(release,"partner-registrar"),handles=requiredRole(release,"handle-registry"),
    owner=requiredRole(release,"partner-owner");
  const reader=createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher,signal});
  const pin=resource=>({...resource,sha256:resource.sha256.replace(/^0x/u,"")});
  let corpusPromise,disposed=false;
  const corpus=()=>{
    if(disposed||signal?.aborted)throw Error("Family partner registry service is disposed.");
    if(!corpusPromise){
      corpusPromise=Promise.all([reader.bytes(pin(profile.corpus)),reader.bytes(pin(profile.corpusMetadata))])
        .then(([bytes,metadata])=>authenticateVantaPolicyCorpus({profile,corpus:bytes,metadata}));
      corpusPromise.catch(()=>{corpusPromise=undefined;});
    }
    return corpusPromise;
  };
  const context=async(assetIndex)=>{
    if(disposed)throw Error("Family partner registry service is disposed.");
    const c=await finalizedPolicyContext({provider,verificationProvider,profile,pins:familyPolicyDeploymentPins(release,inventory,profile,assetIndex)});
    const [directory,handleRegistry,ownerVerifier,genesis,canonicalToken,administrator]=await Promise.all([
      ...["registry","handleRegistry","ownerVerifier","releaseGenesisHash","canonicalToken"].map(method=>
        policyReadBoth(c,registrar.address,REGISTRAR,method)),
      policyReadBoth(c,registry.address,REGISTRY,"administrator")]);
    if(!same(directory[0],registry.address)||!same(handleRegistry[0],handles.address)||
       !same(ownerVerifier[0],owner.address)||!same(genesis[0],profile.genesisHash)||
       !same(administrator[0],registrar.address)||same(canonicalToken[0],ZERO))
      throw Error("Family partner registrar immutable scope differs from the signed deployment.");
    const assets=inventory.funding.pools.map(p=>getAddress(p.asset)),pools=[],[configuredAssets]=await policyReadBoth(c,registrar.address,REGISTRAR,'canonicalAssets');
    if(assets.length<2||assets.length>8||!same(assets[0],ZERO)||!same(assets[1],canonicalToken[0])||
       configuredAssets.length!==assets.length||configuredAssets.some((asset,index)=>!same(asset,assets[index])))
      throw Error('Registrar assets differ from the complete signed funding inventory.');
    for(const asset of assets){
      const [address]=await policyReadBoth(c,registry.address,REGISTRY,"activePoolForAsset",[asset]);
      const pool=release.lock.contracts.find(item=>item.kind==="pool"&&same(item.address,address));
      if(!pool)throw Error("Canonical partner pool is outside the signed deployment lock.");
      const [actual]=await policyReadBoth(c,pool.address,POOL,"asset");
      if(!same(actual,asset))throw Error("Canonical partner pool custody asset differs.");
      pools.push(pool);
    }
    if(!isFamilyWithdrawalOnlyContext(releaseContext)){
      const [version]=await policyReadBoth(c,registrar.address,REGISTRAR,'assetRegistrationVersion');
      if(version!==3n)throw Error('This SDK requires the gas-bounded asset registrar.');
    }
    return {c,pools,assets};
  };
  const snapshot=async(assetIndex)=>{
    const [{c,pools,assets},publicCorpus]=await Promise.all([context(assetIndex),corpus()]);
    const tables=await Promise.all(pools.flatMap((pool,index)=>assetIndex!==undefined&&index!==assetIndex?[]:[readVantaPolicyTable({context:c,
      registry:registry.address,pool:pool.address,asset:assets[index],corpus:publicCorpus,poseidon:vantaPolicyPoseidon})]));
    return {c,tables,publicCorpus,scope:Object.freeze({profile,registrar:registrar.address,registry:registry.address,assetIndex,
      pools:Object.freeze(pools.map(p=>p.address)),checkpoints:Object.freeze(pools.map(pool=>tables.find(t=>same(t.pool,pool.address))?.root??0n))})};
  };
  const ownerState=async(c,handleId)=>{
    const [identity,handle,bound,registered,revoked]=await Promise.all([
      policyReadBoth(c,registrar.address,REGISTRAR,"partnerIdentity",[handleId]),
      policyReadBoth(c,handles.address,HANDLE,"getHandleState",[handleId]),
      policyReadBoth(c,registrar.address,REGISTRAR,"isPartnerHandleBound",[handleId]),
      policyReadBoth(c,registrar.address,REGISTRAR,"registeredAssetMask",[handleId]),
      policyReadBoth(c,registrar.address,REGISTRAR,"revokedAssetMask",[handleId])]);
    return {identity,handle,bound:bound[0],registered:Number(registered[0]),revoked:Number(revoked[0])};
  };
  const prepareAction=async({wallet,kind,claim,handle,feePolicy,deadline,asset})=>{
    if(isFamilyWithdrawalOnlyContext(releaseContext))throw Error('Historical KZG registries are available for withdrawal policy reads only.');
    if(!wallet||typeof wallet.approveFamilyPartnerAction!=="function")throw Error("An unlocked family wallet is required.");
    const assetIndex=inventory.funding.pools.findIndex(p=>asset==='native'?same(p.asset,ZERO):same(p.asset,asset));
    if(assetIndex<0)throw Error('Choose an asset from the signed SDK inventory.');
    const {c,tables,publicCorpus,scope}=await snapshot(assetIndex);
    const route=await wallet.exportFamilyPartnerReceivingRoute({handle:handle??claim?.handle,releaseContext});
    const current=await ownerState(c,route.handleId);
    if(!current.handle.exists||current.handle.epoch!==1n||
       (kind==="register"?(!claim||(current.registered&(1<<assetIndex))!==0||(current.revoked&(1<<assetIndex))!==0||!same(claim.handleId,route.handleId)||
         !same(current.handle.ownerCommitment,claim.ownerCommitment)||!same(current.handle.recordCommitment,claim.recordCommitment)):
       (!current.bound||!current.identity.exists||current.identity.authorizationCommitment<=0n||(current.registered&(1<<assetIndex))===0)))
      throw Error("Family partner is unavailable, revoked or belongs to another owner.");
    let selected;
    if(kind==="revoke"){
      selected=[];
      for(let operation=0;operation<6;operation++){
        const id=policyHex(await vantaPolicyPoseidon([BigInt(route.handleId),BigInt(operation)]));
        const [found,slot]=await policyReadBoth(c,registry.address,REGISTRY,"partnerSlot",[tables[0].pool,id]);
        const record=tables[0].records[Number(slot)];
        if(!found||!record||record[7]!==true||!same(record[0],id))
          throw Error("Revocation requires all six current owner policies.");
        selected.push({feeBps:Number(record[3]),minimumFee:BigInt(record[4]),maximumFee:BigInt(record[5])});
      }
    }else selected=fees(feePolicy);
    const revision=current.identity.exists?BigInt(current.identity.nextRevision):1n;
    const approval=await wallet.approveFamilyPartnerAction({kind,handle:route.handle,claim,fees:selected,
      revision,deadline:deadline??BigInt(Math.floor(Date.now()/1000)+600),policyScope:scope,
      artifactBaseUrl,fetcher,signal,releaseContext});
    if(!same(approval.ownerCommitment,current.handle.ownerCommitment)||
       BigInt(approval.receiverCommitment)!==BigInt(route.receiverCommitment)||
       !same(approval.routingCommitment,route.routingCommitment)||
       kind!=="register"&&(approval.authorizationCommitment!==current.identity.authorizationCommitment||
         approval.receiverCommitment!==current.identity.receiverCommitment||!same(approval.routingCommitment,current.identity.routingCommitment)))
      throw Error("Family fee action changes the immutable private collector.");
    const action=vantaPolicyOwnerAction({...scope,kind,handleId:approval.handleId,
      authorizationCommitment:approval.authorizationCommitment,receiverCommitment:approval.receiverCommitment,
      routingCommitment:approval.routingCommitment,salt:approval.salt,fees:selected,revision,deadline:approval.deadline});
    if(action!==approval.actionDigest)throw Error("Family wallet owner proof binds another policy action.");
    const proof=approval.ownershipProof;
    const [valid]=await policyReadBoth(c,owner.address,OWNER,"verifyProof",[
      proof.slice(0,2),[proof.slice(2,4),proof.slice(4,6)],proof.slice(6,8),
      [BigInt(profile.familyTag),BigInt(profile.chainId),BigInt(approval.handleId),BigInt(approval.ownerCommitment),
        approval.authorizationCommitment,action,approval.authorizationNullifier]]);
    if(valid!==true)throw Error("Genuine family private ownership proof was rejected.");
    const batches=await Promise.all(tables.map(table=>prepareVantaPolicyBatch({context:c,table,corpus:publicCorpus,
      basePartnerId:BigInt(approval.handleId),receiverCommitment:approval.receiverCommitment,
      authorizationCommitment:approval.authorizationCommitment,fees:selected,registration:kind==="register",
      revoke:kind==="revoke",poseidon:vantaPolicyPoseidon})));
    const keys=batches[0].keys,tail=[revision,approval.deadline,proof,approval.authorizationNullifier];
    const checkpoint=tables[0].root;
    const args=kind==="register"?[approval.handleId,approval.authorizationCommitment,approval.receiverCommitment,
      approval.routingCommitment,approval.salt,assetIndex,selected,checkpoint,keys,...tail]:kind==="update"?
      [approval.handleId,assetIndex,selected,checkpoint,keys,...tail]:[approval.handleId,assetIndex,checkpoint,keys,...tail];
    const method={register:"registerPartnerAsset",update:"updatePartnerAssetFees",revoke:"revokePartnerAsset"}[kind],
      calldata=REGISTRAR.encodeFunctionData(method,args);
    // A real bounded call, not an unlimited eth_call, proves this transaction
    // fits below Chikyu's 10M block limit before any wallet submission.
    const simulated=await Promise.all([provider,verificationProvider].map(p=>p.call({to:registrar.address,
      data:calldata,gasLimit:8_000_000n,blockTag:c.block})));
    if(simulated.some(v=>v!=="0x"))throw Error('Asset registration did not pass its bounded execution check.');
    await assertStablePolicyContext(c);
    return Object.freeze({schema:intentSchema,kind,assetIndex,asset:inventory.funding.pools[assetIndex].asset,
      chainId:profile.chainId,generationId:profile.generationId,handleId:approval.handleId,
      approval,request:Object.freeze({chainId:profile.chainId,registrar:registrar.address,
        calldata,settlementNonce:relayNonce(profile.chainId,registrar.address,calldata,kind),maxGasLimit:"8000000"}),
      expectedRoots:Object.freeze(batches.map(batch=>batch.nextRoot)),expectedVersions:Object.freeze(batches[0].versions),
      registryBlock:c.block,registryBlockHash:c.blockHash});
  };
  const validateIntent=prepared=>{
    if(prepared?.schema!==intentSchema||prepared.generationId!==profile.generationId||
       prepared.chainId!==profile.chainId||!["register","update","revoke"].includes(prepared.kind)||
       !same(prepared.request?.registrar,registrar.address)||prepared.request.chainId!==profile.chainId||
       prepared.request.settlementNonce!==relayNonce(profile.chainId,registrar.address,prepared.request.calldata,prepared.kind))
      throw Error("Pending partner intent targets a different KZG generation or calldata.");
    const method={register:"registerPartnerAsset",update:"updatePartnerAssetFees",revoke:"revokePartnerAsset"}[prepared.kind];
    const args=REGISTRAR.decodeFunctionData(method,prepared.request.calldata);
    const approval=prepared.approval;
    if(!same(args.handleId,prepared.handleId)||!approval||!same(approval.handleId,args.handleId)||
       args.deadline!==approval.deadline||args.authorizationNullifier!==approval.authorizationNullifier||
       !Array.isArray(approval.ownershipProof)||approval.ownershipProof.length!==8||
       args.ownershipProof.some((value,index)=>value!==approval.ownershipProof[index])||
       !approval.policyScope||approval.policyScope.profile.generationId!==profile.generationId||
       !same(approval.policyScope.registry,registry.address)||!same(approval.policyScope.registrar,registrar.address)||
       !Number.isInteger(prepared.assetIndex)||prepared.assetIndex<0||prepared.assetIndex>=inventory.funding.pools.length||
       Number(args.assetIndex)!==prepared.assetIndex||approval.policyScope.assetIndex!==prepared.assetIndex||
       !same(prepared.asset,inventory.funding.pools[prepared.assetIndex].asset)||
       !Array.isArray(approval.policyScope.pools)||approval.policyScope.pools.length!==inventory.funding.pools.length||
       approval.policyScope.pools.some((p,i)=>!same(p,inventory.funding.pools[i].pool))||
       !Array.isArray(approval.policyScope.checkpoints)||approval.policyScope.checkpoints.length!==inventory.funding.pools.length||
       args.checkpoint!==approval.policyScope.checkpoints[prepared.assetIndex]||args.revision!==approval.revision||
       prepared.request.maxGasLimit!=="8000000"||args.getValue("keys").length!==6||
       !Array.isArray(prepared.expectedRoots)||prepared.expectedRoots.length!==1||
       !Array.isArray(prepared.expectedVersions)||prepared.expectedVersions.length!==6)
      throw Error("Pending KZG intent metadata differs from its exact calldata.");
    if(prepared.kind==="register"?(args.authorizationCommitment!==approval.authorizationCommitment||
       args.receiverCommitment!==approval.receiverCommitment||!same(args.routingCommitment,approval.routingCommitment)||
       !same(args.salt,approval.salt)):args.revision!==approval.revision)
      throw Error("Pending KZG owner identity or revision differs from calldata.");
    if(prepared.kind!=="revoke"){
      const approved=fees(approval.fees);
      if(args.fees.some((fee,index)=>fee.feeBps!==BigInt(approved[index].feeBps)||
         fee.minimumFee!==approved[index].minimumFee||fee.maximumFee!==approved[index].maximumFee))
        throw Error("Pending KZG fee policy differs from calldata.");
    }
    const action=vantaPolicyOwnerAction({...approval.policyScope,profile,kind:prepared.kind,
      handleId:args.handleId,authorizationCommitment:approval.authorizationCommitment,
      receiverCommitment:approval.receiverCommitment,routingCommitment:approval.routingCommitment,
      salt:approval.salt,fees:approval.fees,revision:approval.revision,deadline:args.deadline});
    if(action!==approval.actionDigest)throw Error("Pending KZG owner digest differs from calldata.");
    return args;
  };
  return Object.freeze({assetRegistrationVersion:3,chainId:profile.chainId,generationId:profile.generationId,
    assets:Object.freeze(inventory.funding.pools.map(p=>Object.freeze({asset:p.asset,symbol:p.assetSymbol}))),
    async partnerAssets({wallet,handle}){
      const route=await wallet.exportFamilyPartnerReceivingRoute({handle,releaseContext}),{c}=await context(),state=await ownerState(c,route.handleId);
      if(state.identity.exists&&(state.identity.receiverCommitment!==BigInt(route.receiverCommitment)||!same(state.identity.routingCommitment,route.routingCommitment)))
        throw Error('This partner identity belongs to another private wallet.');
      return Object.freeze({registeredMask:state.registered,revokedMask:state.revoked,
        assets:Object.freeze(inventory.funding.pools.filter((p,i)=>(state.registered&(1<<i))!==0).map(p=>p.asset))});
    },
    async verifyHandleClaim({claim}){
      const {c}=await context(),state=await policyReadBoth(c,handles.address,HANDLE,'getHandleState',[claim.handleId]);
      if(!state.exists)return false;
      if(state.epoch!==1n||!same(state.ownerCommitment,claim.ownerCommitment)||!same(state.recordCommitment,claim.recordCommitment))
        throw Error('Confirmed handle differs from the saved private claim.');
      return true;
    },
    async prepareHandleClaim({wallet,handle}){
      if(isFamilyWithdrawalOnlyContext(releaseContext))throw Error('Historical KZG registries cannot register new handles.');
      const claim=await wallet.prepareFamilyPartnerHandleClaim({handle,artifactBaseUrl,fetcher,signal,releaseContext});
      const {c}=await context(),state=await policyReadBoth(c,handles.address,HANDLE,"getHandleState",[claim.handleId]);
      if(state.exists&&(!same(state.recordCommitment,claim.recordCommitment)||!same(state.ownerCommitment,claim.ownerCommitment)||state.epoch!==1n))
        throw Error("Family handle is owned by another private wallet.");
      await assertStablePolicyContext(c);
      return Object.freeze({claim,alreadyClaimed:state.exists,request:state.exists?null:Object.freeze({
        chainId:profile.chainId,registrar:handles.address,calldata:claim.calldata,
        settlementNonce:claim.settlementNonce,maxGasLimit:"4000000"})});
    },
    prepareRegistration:input=>prepareAction({...input,kind:"register"}),
    prepareFeeUpdate:input=>prepareAction({...input,kind:"update"}),
    prepareRevocation:input=>prepareAction({...input,kind:"revoke"}),
    async resolveMembership({asset,basePartnerId,operation,relation="combined"}){
      if(!["combined","enhanced"].includes(relation)||
         !Number.isInteger(operation)||operation<0||operation>5)
        throw Error("Invalid family partner membership scope.");
      const selected=selectVantaFamilyFundingResources(release,inventory,asset).deployment;
      const assetIndex=inventory.funding.pools.findIndex(p=>same(p.pool,selected.pool));
      const {c,tables,publicCorpus}=await snapshot(assetIndex),table=tables.find(t=>same(t.pool,selected.pool));
      if(!table)throw Error('Partner policy pool is outside the signed funding inventory.');
      const partnerId=policyHex(await vantaPolicyPoseidon([policyField(basePartnerId,"base partner"),BigInt(operation)]));
      const {slot,record}=findVantaPolicyRecord(table,partnerId);
      const version=BigInt(record[1]),receiverCommitment=policyField(record[2],"receiver"),feeBps=Number(record[3]),
        feeMinimum=BigInt(record[4]),feeMaximum=BigInt(record[5]),authorizationKey=policyField(record[6],"authorization");
      const leaf=await vantaPolicyLeaf({context:table.policyContext,basePartnerId,operation,version,receiverCommitment,
        feeBps,feeMinimum,feeMaximum,authorizationKey,poseidon:vantaPolicyPoseidon});
      if(leaf!==table.rows[slot])throw Error("Family policy does not match the authenticated KZG row.");
      const policyLookup=await buildVantaPolicyLookup({table,slot,corpus:publicCorpus,runtime:proofRuntime});
      await assertStablePolicyContext(c);
      const result=Object.freeze({registry:registry.address,pool:table.pool,asset:table.asset,relation,
        basePartnerId,partnerId,operation,slot,root:table.root,policyContext:table.policyContext,policyLookup,
        version,receiverCommitment,feeBps,feeMinimum,feeMaximum,authorizationKey,
        finalizedBlock:c.block,finalizedBlockHash:c.blockHash});
      memberships.add(result);return result;
    },
    bindCombinedWitness({membership,fee,partner}){
      if(!memberships.has(membership)||membership.relation!=="combined")
        throw Error("Combined fee proof needs SDK-authenticated family policy membership.");
      if(Object.hasOwn(partner,"siblings"))throw Error("Legacy partner Merkle witnesses are unsupported.");
      const m=membership;
      return Object.freeze({schema:"vanta-v8-kzg-combined-fee-partner-witness-v1",fee,
        partner:Object.freeze({...partner,schema:"vanta-v8-kzg-partner-witness-v1",chain_id:profile.chainId,
          registry:m.registry,pool:m.pool,asset:m.asset,current_registry_root:policyHex(m.root),policy_context:policyHex(m.policyContext),
          registry_slot:m.slot,base_partner_id:policyHex(m.basePartnerId),partner_id:m.partnerId,version:policyHex(m.version),
          receiver_commitment:policyHex(m.receiverCommitment),fee_bps:m.feeBps,fee_minimum_units:m.feeMinimum.toString(),
          fee_maximum_units:m.feeMaximum.toString(),authorization_key:policyHex(m.authorizationKey)}),policy_lookup:m.policyLookup});
    },
    bindEnhancedWitness({membership,fee,partner,protocolBps}){
      if(!memberships.has(membership)||membership.relation!=="enhanced"||
         !Number.isInteger(protocolBps)||protocolBps<0||protocolBps>10_000)
        throw Error("Enhanced fee proof needs SDK-authenticated family policy membership.");
      if(Object.hasOwn(partner,"siblings"))throw Error("Legacy partner Merkle witnesses are unsupported.");
      const m=membership;
      if(!same(fee.pool,m.pool)||!same(fee.asset,m.asset)||fee.chain_id!==profile.chainId)
        throw Error('Enhanced fee and partner policy must use the same pool and asset.');
      return Object.freeze({schema:"vanta-family-kzg-enhanced-fee-witness-v1",fee:{...fee,pool:m.pool,asset:m.asset},
        genesis_hash:profile.genesisHash,generation_id:profile.generationId,protocol_bps:protocolBps,
        partner:Object.freeze({...partner,schema:"vanta-v8-kzg-partner-witness-v1",chain_id:profile.chainId,
          registry:m.registry,pool:m.pool,asset:m.asset,current_registry_root:policyHex(m.root),policy_context:policyHex(m.policyContext),
          registry_slot:m.slot,base_partner_id:policyHex(m.basePartnerId),partner_id:m.partnerId,version:policyHex(m.version),
          receiver_commitment:policyHex(m.receiverCommitment),fee_bps:m.feeBps,fee_minimum_units:m.feeMinimum.toString(),
          fee_maximum_units:m.feeMaximum.toString(),authorization_key:policyHex(m.authorizationKey)}),policy_lookup:m.policyLookup});
    },
    async verifyReceipt({prepared,transactionHash}){
      validateIntent(prepared);
      const [a,b,ta,tb]=await Promise.all([provider.getTransactionReceipt(transactionHash),verificationProvider.getTransactionReceipt(transactionHash),
        provider.getTransaction(transactionHash),verificationProvider.getTransaction(transactionHash)]);
      if(!a||!b||a.status!==1||b.status!==1||!same(a.blockHash,b.blockHash)||a.blockNumber!==b.blockNumber||
         !same(a.to,registrar.address)||!same(b.to,registrar.address)||!same(ta?.to,registrar.address)||!same(tb?.to,registrar.address)||
         !same(ta?.data,prepared.request.calldata)||!same(tb?.data,prepared.request.calldata)||!same(ta?.hash,transactionHash)||!same(tb?.hash,transactionHash)||
         a.logs.length!==b.logs.length||a.logs.some((log,index)=>!same(log.address,b.logs[index].address)||
           !same(log.data,b.logs[index].data)||log.topics.length!==b.logs[index].topics.length||
           log.topics.some((topic,i)=>!same(topic,b.logs[index].topics[i]))))
        throw Error("Family partner transaction is not an independently verified receipt.");
      const {c}=await context();if(c.block<a.blockNumber)throw Error("Partner transaction is awaiting confirmations.");
      const [ba,bb]=await Promise.all([provider.getBlock(a.blockNumber),verificationProvider.getBlock(a.blockNumber)]);
      if(!same(ba?.hash,a.blockHash)||!same(bb?.hash,a.blockHash))throw Error("Partner receipt block was reorganized.");
      const changes=a.logs.filter(log=>same(log.address,registry.address)).flatMap(log=>{
        try{const event=REGISTRY.parseLog(log);return event?.name==="PartnerVersionChanged"?[event]:[];}catch{return[];}});
      await verifyFamilyPartnerPolicyChanges({prepared,changes});
      return Object.freeze({transactionHash,blockNumber:a.blockNumber,blockHash:a.blockHash,verifiedOnChain:true});
    },
    serializePending(prepared){validateIntent(prepared);return json(prepared);},
    restorePending(serialized){const prepared=parse(serialized);validateIntent(prepared);return Object.freeze(prepared);},
    dispose(){disposed=true;corpusPromise=undefined;},
  });
}
