/** Public fee-policy access is bound only to this SDK's sealed deployment. */
import {getCompiledFamilyEvmRelease,isFamilyWithdrawalOnlyContext} from './family-network.mjs';
import {readFamilyProtocolFeesCore,prepareFamilyProtocolFeeUpdateCore,readFixedFamilyProtocolFeesCore} from './family-fee-policy-core.mjs';
export async function readVantaFamilyProtocolFees({provider,verificationProvider,pool,blockTag,releaseContext}={}) {
 const release=getCompiledFamilyEvmRelease(releaseContext),options={provider,verificationProvider,pool,blockTag,release};
 if(isFamilyWithdrawalOnlyContext(releaseContext)&&!release.lock.contracts.some(r=>r.name==='protocol-fee-policy'))
  return readFixedFamilyProtocolFeesCore(options);
 return readFamilyProtocolFeesCore(options);
}
export async function prepareVantaFamilyProtocolFeeUpdate({provider,verificationProvider,pool,blockTag,rates,releaseContext}={}) {
 if(isFamilyWithdrawalOnlyContext(releaseContext))throw Error('Historical withdrawal policies cannot be updated.');
 return prepareFamilyProtocolFeeUpdateCore({provider,verificationProvider,pool,blockTag,rates,release:getCompiledFamilyEvmRelease(releaseContext)});
}
