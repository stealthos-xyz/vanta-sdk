import {getCompiledFamilyPoolGenerations,selectCompiledFamilyGeneration,getCompiledFamilyEvmRelease} from '../fresh/family-network.mjs';
import {createVantaFamilyGenerationWallet} from '../fresh/family-wallet-generations.mjs';
import {connectStealthOSWalletCore} from '../fresh/wallet-core-client.mjs';
import {inspectVantaFamilySdkUpdate} from '../fresh/family-sdk-update.mjs';
const catalog=getCompiledFamilyPoolGenerations(),context=selectCompiledFamilyGeneration({networkId:'eip155:6281971'});
getCompiledFamilyEvmRelease(context);
// @ts-expect-error Apps cannot manufacture a compiled release capability.
getCompiledFamilyEvmRelease({networkId:context.networkId,generationId:context.generationId,mode:'active',setupId:context.setupId});
// @ts-expect-error The selected generation is immutable.
context.mode='active';
type Options=Parameters<typeof createVantaFamilyGenerationWallet>[0];
function wallet(options:Options){const host=createVantaFamilyGenerationWallet(options);
 void host.openWithdrawal({networkId:context.networkId,generationId:context.generationId,asset:'native'});
 return host;
}
const publicWallet=connectStealthOSWalletCore();
void publicWallet.balance({networkId:context.networkId,generationId:context.generationId,asset:'native'});
// @ts-expect-error A partner cannot request wallet phrases through the public connector.
publicWallet.exportRecoveryPhrase();
// @ts-expect-error The partner cannot choose another wallet origin.
connectStealthOSWalletCore({origin:'https://other.example'});
void [catalog,wallet,inspectVantaFamilySdkUpdate];
