import {getCompiledFamilyEvmRelease} from "./family-network.mjs";
import {composeVantaFamilyEnhancedRelayTransport} from "./family-enhanced-relay-core.mjs";
/** Trusted host initialization only. This transport never activates a release
 * and never accepts a relay service's internal ID instead of the request ID. */
export function createVantaFamilyEnhancedRelayTransport(options){
  const release=getCompiledFamilyEvmRelease(options?.releaseContext);
  return composeVantaFamilyEnhancedRelayTransport({...options,getRelease:()=>release});
}
