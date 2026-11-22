/** Public fee-policy access is bound only to this SDK's sealed deployment. */
import {getCompiledFamilyEvmRelease,isFamilyWithdrawalOnlyContext} from './family-network.mjs';
import {readFamilyProtocolFeesCore,readFixedFamilyProtocolFeesCore} from './family-fee-policy-core.mjs';
export async function readVantaFamilyProtocolFees({provider,verificationProvider,pool,blockTag,releaseContext}={}) {
 const release=getCompiledFamilyEvmRelease(releaseContext),options={provider,verificationProvider,pool,blockTag,release};
 if(isFamilyWithdrawalOnlyContext(releaseContext)&&!release.lock.contracts.some(r=>r.name==='protocol-fee-policy'))
  return readFixedFamilyProtocolFeesCore(options);
 return readFamilyProtocolFeesCore(options);
}
