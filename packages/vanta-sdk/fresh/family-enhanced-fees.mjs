/** The supported private-fee component of enhanced settlement. Ordinary
 * authorization/claim proof production is a separate upstream deliverable. */
import {createVantaFamilyProofRuntime} from "./family-proof-runtime.mjs";
import {createVantaFamilyPartnerRegistry} from "./family-partner-registry.mjs";
import {composeVantaFamilyEnhancedFeeProver} from "./family-enhanced-fees-core.mjs";

export async function createVantaFamilyEnhancedFeeProver({provider,verificationProvider,artifactBaseUrl,
  fetcher,signal,onProgress,onSelectedDriver,releaseContext}={}){
  if(!provider||!verificationProvider||provider===verificationProvider)
    throw Error("Independent family RPC providers are required.");
  signal?.throwIfAborted();
  const proofRuntime=await createVantaFamilyProofRuntime({provider,artifactBaseUrl,fetcher,signal,onProgress,onSelectedDriver,releaseContext});
  try{
    const registry=await createVantaFamilyPartnerRegistry({provider,verificationProvider,artifactBaseUrl,proofRuntime,fetcher,signal,releaseContext});
    const core=composeVantaFamilyEnhancedFeeProver({registry,proofRuntime,signal});
    return Object.freeze({...core,warmProofRuntime:()=>proofRuntime.warmEnhancedRuntime()});
  }catch(error){proofRuntime.dispose();throw error;}
}
