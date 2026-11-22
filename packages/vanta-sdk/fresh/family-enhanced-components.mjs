/** Typed ordinary 19/15-input components. These deliberately remain labelled
 * non-funds-capable while the final resource/consumer qualification is open. */
import {Interface,getAddress} from "ethers";
import {getSharedConfirmedBlock} from './transaction-confirmations.mjs';
import {getCompiledFamilyEvmRelease,verifyCompiledFamilyOperationRuntime} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources,createVantaFamilyProofArtifactReader} from "./family-proof-resources.mjs";
import {composeVantaFamilyEnhancedComponents} from "./family-enhanced-components-core.mjs";
import {proveEnhancedAuthorizationInWorker} from "./family-enhanced-authorization-worker.mjs";
const POOL=new Interface(["function asset() view returns(address)",
  "function enhancedClaimRoots() view returns(uint256 reservationRoot,uint256 spentRoot,uint64 epoch)"]);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const fail=message=>{throw Error(message);};
export async function createVantaFamilyEnhancedComponents({provider,verificationProvider,pool,artifactBaseUrl,fetcher,signal,releaseContext}={}){
  const Scope=globalThis.DedicatedWorkerGlobalScope;
  if(typeof Scope!=="function"||!(globalThis instanceof Scope)||typeof document!=="undefined")
    fail("Ordinary enhanced components require a dedicated local browser proof worker.");
  if(!provider||!verificationProvider||provider===verificationProvider)fail("Independent family RPC providers are required.");
  const release=getCompiledFamilyEvmRelease(releaseContext),inventory=getCompiledVantaFamilyProofResources(release,releaseContext);
  const poolAddress=getAddress(pool),pin=release.lock.contracts.find(row=>row.kind==="pool"&&getAddress(row.address)===poolAddress);
  if(!pin)fail("Enhanced pool is absent from the signed deployment lock.");
  const verifyActivation=async()=>{signal?.throwIfAborted();await Promise.all([
    provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,poolAddress,releaseContext,['enhanced-authorization','enhanced-claim'])));signal?.throwIfAborted();};
  const readBoth=async(method,blockTag)=>{
    const tx={to:poolAddress,data:POOL.encodeFunctionData(method),blockTag};
    const [a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
    if(!same(a,b))fail("Independent enhanced pool reads disagree.");return POOL.decodeFunctionResult(method,a);
  };
  const selected=inventory.funding.pools.find(p=>getAddress(p.pool)===poolAddress);
  if(!selected)fail('Enhanced pool is outside the signed resource inventory.');
  const asset=selected.asset;
  const domain=Object.freeze({familyTag:release.setup.family.tag,chainId:release.pins.networkId.split(":")[1],
    pool:poolAddress.toLowerCase(),asset:getAddress(asset).toLowerCase(),genesisHash:release.pins.genesisHash,generationId:release.pins.generationId});
  const reader=createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher,signal}),runtimes=new Map();
  const authorizationLifetime=new AbortController();
  const cancelAuthorization=()=>authorizationLifetime.abort(signal?.reason);
  if(signal?.aborted)cancelAuthorization();
  else signal?.addEventListener("abort",cancelAuthorization,{once:true});
  const load=async role=>{
    const item=inventory.enhancedComponents[role];if(!item)fail("Missing signed ordinary enhanced role.");
    const runtimeKey=item.runtime.glue.sha256+":"+item.runtime.wasm.sha256;
    let pending=runtimes.get(runtimeKey);
    if(!pending){pending=(async()=>{
      const [glue,wasm]=await Promise.all([reader.bytes(item.runtime.glue),reader.bytes(item.runtime.wasm)]);
      const source=new Blob([glue],{type:"text/javascript"}),url=URL.createObjectURL(source);
      try{const [loaded,module]=await Promise.all([
        import(/* webpackIgnore: true */ /* @vite-ignore */url),WebAssembly.compile(wasm)]);
        await loaded.default({module_or_path:module});
        for(const name of ["prepare_enhanced_authorization","prove_enhanced_authorization","prepare_enhanced_claim_request","prove_enhanced_claim_capability","inspect_enhanced_claim_capability"])
          if(typeof loaded[name]!=="function")fail("Pinned enhanced WASM lacks the typed "+name+" API.");
        return {wasm:loaded,module,glue:source};
      }finally{URL.revokeObjectURL(url);glue.fill(0);wasm.fill(0);}
    })();runtimes.set(runtimeKey,pending);pending.catch(()=>runtimes.delete(runtimeKey));}
    const {wasm,module,glue}=await pending;
    return {wasm,provingKeySha256:item.provingKey.sha256,key:()=>reader.bytes(item.provingKey),
      proveAuthorization:(witness,release,key)=>proveEnhancedAuthorizationInWorker({
        glue,module,witness,release,key,signal:authorizationLifetime.signal})};
  };
  const verifyProof=async(role,proof,values)=>{
    const item=inventory.enhancedComponents[role],abi=new Interface([
      `function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[${item.publicInputs}]) view returns(bool)`]);
    const tx={to:item.verifier.address,data:abi.encodeFunctionData("verifyProof",[proof.a,proof.b,proof.c,values])};
    const [a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
    if(!same(a,b)||abi.decodeFunctionResult("verifyProof",a)[0]!==true)fail("Ordinary proof failed its two pinned Solidity verifiers.");
  };
  const authenticateClaim=async refresh=>{
    const [a,b]=await Promise.all([provider.getBlock("latest"),verificationProvider.getBlock("latest")]);
    if(!a?.hash||!b?.hash)fail("Enhanced claim checkpoint is unavailable.");
    const height=Math.min(a.number,b.number),[atA,atB,roots]=await Promise.all([
      provider.getBlock(height),verificationProvider.getBlock(height),readBoth("enhancedClaimRoots",height)]);
    if(!atA?.hash||!same(atA.hash,atB?.hash)||atA.timestamp!==atB.timestamp||
      BigInt(refresh.checkpoint.reservationRoot)!==roots[0]||BigInt(refresh.checkpoint.spentNullifierRoot)!==roots[1]||
      BigInt(refresh.checkpoint.checkpointEpoch)!==roots[2]||BigInt(refresh.checkpoint.executionEpoch)!==roots[2]||
      BigInt(Math.floor(atA.timestamp/60))!==roots[2])fail("Claim roots/time are not the same independently observed global checkpoint.");
    const [stableA,stableB]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
    if(!same(stableA?.hash,atA.hash)||!same(stableB?.hash,atA.hash))fail("Claim checkpoint changed during authentication.");
  };
  const core=composeVantaFamilyEnhancedComponents({domain,load,verifyProof,authenticateClaim,verifyActivation,signal});
  return Object.freeze({...core,async warmProofRuntime(){
    signal?.throwIfAborted();const item=await load('enhanced-authorization');
    const bytes=await item.key();bytes.fill(0);signal?.throwIfAborted();
  },dispose(){
    cancelAuthorization();signal?.removeEventListener("abort",cancelAuthorization);core.dispose();runtimes.clear();
  }});
}
