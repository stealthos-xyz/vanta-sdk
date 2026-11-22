import {createVantaFamilyPartnerRegistry} from "./family-partner-registry.mjs";
import {verifyCompiledFamilyEvmRuntime} from "./family-network.mjs";
import {createVantaFamilyProofRuntime} from "./family-proof-runtime.mjs";
import {VantaHostWorkerError,vantaHostWorkerProtocol as protocol}
  from "./host-worker.mjs";

/** Production composition boundary for a family worker. The compiled signed
 * activation/graph MUST pass before initializeRuntime can unlock a secret or
 * load a prover. There is no injectable replacement for release verification.
 * initializeRuntime supplies only implemented operations using the existing
 * pinned family engine, artifacts, scoped storage and relayer transport.
 * This factory does not manufacture missing funded-operation implementations.
 */
export function createVantaFamilyHostRuntimeFactory({provider,verificationProvider,initializeRuntime,proofArtifacts}={}){
  if(!provider||typeof initializeRuntime!=="function")
    throw new VantaHostWorkerError("RUNTIME_UNAVAILABLE");
  return async function createRuntime({context,signal,reportProgress}={}){
    const scope=protocol.context(context);
    signal?.throwIfAborted();
    const verified=await verifyCompiledFamilyEvmRuntime(provider);
    signal?.throwIfAborted();
    if(verified.networkId!==scope.networkId||verified.generationId!==scope.generationId)
      throw new VantaHostWorkerError("CONTEXT_CHANGED");
    let proofs=null,partners=null,runtime=null;
    try{
      if(proofArtifacts){
        if(!proofArtifacts||typeof proofArtifacts!=="object"||
          Object.keys(proofArtifacts).some(key=>!["artifactBaseUrl","fetcher"].includes(key)))
          throw new VantaHostWorkerError("RUNTIME_UNAVAILABLE");
        proofs=await createVantaFamilyProofRuntime({provider,...proofArtifacts,signal});
        // Existing proof-only hosts need no second RPC. Partner reads and owner
        // mutations are available only when their independent verifier is supplied.
        if(verificationProvider)partners=await createVantaFamilyPartnerRegistry({provider,verificationProvider,
          ...proofArtifacts,proofRuntime:proofs,signal});
      }
      runtime=await initializeRuntime({context:scope,verifiedRelease:verified,
        proofs,partners,signal,reportProgress});
      signal?.throwIfAborted();
      if(!runtime||typeof runtime.execute!=="function"||typeof runtime.dispose!=="function")
        throw new VantaHostWorkerError("RUNTIME_UNAVAILABLE");
      const capabilities=protocol.capabilities(runtime.capabilities);
      if(capabilities.some(command=>["deposit","privateSend","withdraw","swap","bridge"].includes(command))&&!proofs)
        throw new VantaHostWorkerError("RUNTIME_UNAVAILABLE");
      return Object.freeze({verifiedContext:scope,capabilities,
        execute:(...args)=>runtime.execute(...args),async dispose(){
          partners?.dispose();proofs?.dispose();await runtime.dispose();
        }});
    }catch(error){
      partners?.dispose();proofs?.dispose();
      try{await runtime?.dispose?.();}catch{/* Never expose native disposal details. */}
      throw error;
    }
  };
}
