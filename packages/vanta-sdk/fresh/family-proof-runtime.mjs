/** Production composition for funded family proof methods. No request can
 * select a key, runtime, worker count, legacy prover, or remote proving URL. */
import {getCompiledFamilyEvmRelease,getCompiledFamilyWalletContext} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources,createVantaFamilyProofArtifactReader,
  assertVantaFamilyStreamManifestPins} from "./family-proof-resources.mjs";
import {proveVantaFamilyBound4InWallet,selectVantaFamilyBound4Driver} from "./family-proof-driver.mjs";

import {initializeFamilyProofModule} from "./family-proof-module.mjs";

const exact=(value,fields)=>{
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join()!==fields.slice().sort().join())
    throw Error("Family proof request has missing or unsupported fields.");
};
const parse=bytes=>{
  if(bytes.length>2*1024*1024)throw Error("Family proof manifest exceeds its bound.");
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
  finally{bytes.fill(0);}
};
const standardFields=["walletWitness","expectedPublicSignals"];
const gateFields=["walletWitness","hashBinding","authenticatedWalletCache","expectedPublicStatement",
  "expectedCheckpointRef","expectedSourceEpoch"];
const contextMatches=(a,b)=>a.networkId===b.networkId&&a.generationId===b.generationId&&
  a.setupId===b.setupId&&a.lockId===b.lockId;

export async function createVantaFamilyProofRuntime({provider,artifactBaseUrl,fetcher,
  signal,onProgress,onSelectedDriver,releaseContext}={}){
  const Scope=globalThis.DedicatedWorkerGlobalScope;
  if(typeof Scope!=="function"||!(globalThis instanceof Scope)||typeof globalThis.document!=="undefined")
    throw Error("Family STREAM_BOUND4 initialization requires a dedicated local browser proof worker.");
  signal?.throwIfAborted();
  const verified=getCompiledFamilyWalletContext(releaseContext);
  signal?.throwIfAborted();
  const release=getCompiledFamilyEvmRelease(releaseContext);
  const inventory=getCompiledVantaFamilyProofResources(release,releaseContext);
  const descriptor=release.proving.driver;
  let disposed=false,active=null;
  // Keys come only from the fixed seven-profile inventory, never user URLs.
  // At most four distinct main WASM modules may live in this proof worker.
  const runtimes=new Map();
  const stop=()=>{disposed=true;active?.abort();runtimes.clear();};
  signal?.addEventListener("abort",stop,{once:true});

  const loadRuntime=(profile,width,reader,sessionSignal)=>{
    const runtimeKey=profile.runtime.glue.sha256+":"+profile.runtime.wasm.sha256;
    let initializing=runtimes.get(runtimeKey);
    if(!initializing){
      if(runtimes.size>=4)throw Error("Family proof runtime exceeds its bounded module inventory.");
      initializing=initializeFamilyProofModule({reader,runtime:profile.runtime,profileName:width===32?"32x5":"8x5",signal:sessionSignal});
      runtimes.set(runtimeKey,initializing);
      initializing.catch(()=>{if(runtimes.get(runtimeKey)===initializing)runtimes.delete(runtimeKey);});
    }
    return initializing;
  };
  const perform=async(relation,width,request,sessionSignal)=>{
    selectVantaFamilyBound4Driver(descriptor,relation,width);
    const standard=["payout-aggregate","combined-fee-partner","enhanced-fee-partner"].includes(relation);
    exact(request,standard?standardFields:gateFields);
    const name=standard?(relation==="payout-aggregate"?"aggregate":relation==="enhanced-fee-partner"?"enhanced":"combined"):
      `${relation}${width}`;
    const profile=inventory.profiles[name];
    const reader=createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher,signal:sessionSignal});
    const initializing=loadRuntime(profile,width,reader,sessionSignal);
    const [runtime,keyBytes,matrixBytes]=await Promise.all([
      initializing,reader.bytes(standard?profile.keyManifest:profile.m2Manifest),reader.bytes(profile.matrixManifest),
    ]);
    const key=parse(keyBytes),matrix=parse(matrixBytes);
    assertVantaFamilyStreamManifestPins({name,profile,key,matrix,driver:descriptor});
    const common={descriptor,relation,width,wasm:runtime.wasm,
      createShardWorker:runtime.createShardWorker,signal:sessionSignal,
      onProgress:stage=>onProgress?.({relation,width,stage}),
      onSelectedDriver,...request};
    if(standard){
      const [fixedKey,policyLookupKey]=await Promise.all([reader.bytes(profile.fixedKey),
        profile.policyLookupKey?reader.bytes(profile.policyLookupKey):Promise.resolve(null)]);
      try{return await proveVantaFamilyBound4InWallet({...common,manifest:key,
        approvedKeySha256:profile.provingKeySha256,fixedKey,matrixManifest:matrix,
        ...(policyLookupKey?{policyLookupKey,approvedPolicyLookupKeySha256:profile.policyLookupKey.sha256}:{}),
        approvedMatrixSha256:profile.matrix.sha256,
        readMatrixChunk:(offset,length)=>reader.range(profile.matrix,offset,length),
        readQueryChunk:(section,offset,length)=>reader.range(profile.queries[section],offset,length)});}
      finally{fixedKey.fill(0);policyLookupKey?.fill(0);}
    }
    const [m2ManifestBytes,matrixManifestBytes,publicMaterialBytes]=await Promise.all([
      reader.bytes(profile.m2Manifest),reader.bytes(profile.matrixManifest),reader.bytes(profile.publicMaterial)]);
    try{return await proveVantaFamilyBound4InWallet({...common,m2ManifestBytes,
      approvedM2ManifestSha256:profile.m2Manifest.sha256,approvedM2PackageSha256:profile.m2Key.sha256,
      matrixManifestBytes,approvedMatrixManifestSha256:profile.matrixManifest.sha256,
      approvedMatrixSha256:profile.matrix.sha256,approvedSetupLockSha256:profile.setupLockSha256,
      publicMaterial:parse(publicMaterialBytes),
      readM2Chunk:(offset,length)=>reader.range(profile.m2Key,offset,length),
      readMatrixChunk:(offset,length)=>reader.range(profile.matrix,offset,length)});}
    finally{m2ManifestBytes.fill(0);matrixManifestBytes.fill(0);publicMaterialBytes.fill(0);}
  };
  const session=async(requestSignal,work)=>{
    if(disposed||signal?.aborted)throw Error("Family proof runtime is disposed.");
    if(active)throw Error("A local family proof operation is already running.");
    requestSignal?.throwIfAborted();
    const controller=new AbortController();active=controller;
    const abort=()=>controller.abort();
    requestSignal?.addEventListener("abort",abort,{once:true});
    try{
      const current=getCompiledFamilyWalletContext(releaseContext);
      controller.signal.throwIfAborted();
      if(!contextMatches(verified,current))throw Error("Family proof activation context changed.");
      const result=await work(controller.signal);
      controller.signal.throwIfAborted();
      const finalContext=getCompiledFamilyWalletContext(releaseContext);
      controller.signal.throwIfAborted();
      if(!contextMatches(verified,finalContext))throw Error("Family proof activation context changed during proving.");
      return result;
    }catch(error){
      // A failed/cancelled operation requires disposal and a host-worker
      // restart. It cannot reuse a partially initialized private session.
      stop();throw error;
    }finally{
      controller.abort();requestSignal?.removeEventListener("abort",abort);active=null;
    }
  };
  const transfer=(mode,input)=>session(input?.signal,async sessionSignal=>{
    const {width,fee,gate0}=input??{};
    if((width!==8&&width!==32)||!Array.isArray(fee?.expectedPublicSignals)||
      fee.expectedPublicSignals.length!==40||BigInt(fee.expectedPublicSignals[7])!==BigInt(mode)||
      (mode===0?BigInt(fee.expectedPublicSignals[36])<=0n:BigInt(fee.expectedPublicSignals[36])!==0n))
      throw Error("Family fee proof does not match the requested private operation.");
    const combined=await perform("combined-fee-partner",width,fee,sessionSignal);
    const normal=await perform("normal",width,gate0,sessionSignal);
    return Object.freeze({combined,normal});
  });
  return Object.freeze({networkId:verified.networkId,generationId:verified.generationId,
    async warmDepositRuntime(){
      if(disposed)throw Error("Family proof runtime is closed.");signal?.throwIfAborted();
      const reader=createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher,signal});
      await loadRuntime(inventory.profiles.combined,0,reader,signal);
    },
    async warmEnhancedRuntime(){
      if(disposed)throw Error("Family proof runtime is closed.");signal?.throwIfAborted();
      const reader=createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher,signal});
      await loadRuntime(inventory.profiles.enhanced,0,reader,signal);
    },
    engine:"STREAM_BOUND4",workerCount:4,
    buildVantaKzgPolicyLookup:(corpus,stateJson)=>session(undefined,async sessionSignal=>{
      if(!(corpus instanceof Uint8Array)||typeof stateJson!=="string")
        throw Error("Family policy recovery needs the authenticated public corpus and state.");
      const reader=createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher,signal:sessionSignal});
      const initializing=loadRuntime(inventory.profiles.normal8,8,reader,sessionSignal),{wasm}=await initializing;
      if(typeof wasm.buildVantaKzgPolicyLookup!=="function")
        throw Error("Pinned STREAM_BOUND4 runtime lacks KZG policy recovery.");
      return wasm.buildVantaKzgPolicyLookup(corpus,stateJson);
    }),
    prepareEnhancedFee:({walletWitness,signal:requestSignal}={})=>session(requestSignal,async sessionSignal=>{
      const reader=createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher,signal:sessionSignal});
      const initializing=loadRuntime(inventory.profiles.enhanced,8,reader,sessionSignal),{wasm}=await initializing;
      if(typeof wasm.prepareVantaFamilyKzgEnhancedFee!=="function")throw Error("Pinned KZG runtime lacks typed enhanced fee preparation.");
      const result=JSON.parse(wasm.prepareVantaFamilyKzgEnhancedFee(JSON.stringify(walletWitness)));
      if(result.schema!=="vanta-family-kzg-enhanced-fee-prepared-v1"||result.role!=="enhanced-fee-partner"||
        result.safeForFunds!==false||!Array.isArray(result.publicSignals)||result.publicSignals.length!==41)
        throw Error("Typed KZG fee preview has the wrong role or public layout.");
      const publicSignals=result.publicSignals.map(value=>{
        if(typeof value!=='string'||!/^(?:0|[1-9][0-9]*|0x[0-9a-f]{64})$/u.test(value))throw Error('Invalid typed enhanced fee field.');
        const n=BigInt(value);if(n>=21888242871839275222246405745257275088548364400416034343698204186575808495617n)throw Error('Enhanced fee field exceeds its range.');
        return '0x'+n.toString(16).padStart(64,'0');
      });
      return Object.freeze({...result,publicSignals:Object.freeze(publicSignals)});
    }),
    prove:({relation,width,request,signal:requestSignal}={})=>
      session(requestSignal,s=>perform(relation,width,request,s)),
    proveDeposit:({request,signal:requestSignal}={})=>
      session(requestSignal,s=>perform("combined-fee-partner",0,request,s)),
    provePrivateSend:input=>transfer(1,input),
    proveWithdrawal:input=>transfer(0,input),
    proveExit:({width,request,signal:requestSignal}={})=>
      session(requestSignal,s=>perform("exit",width,request,s)),
    proveAggregation:({request,signal:requestSignal}={})=>
      session(requestSignal,s=>perform("payout-aggregate",0,request,s)),
    dispose(){stop();signal?.removeEventListener("abort",stop);},
  });
}

