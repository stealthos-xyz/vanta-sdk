/** Trusted wallet composition. Applications select identifiers, never a pool
 * address, release JSON, executable URL or proving-key inventory. */
import {getCompiledFamilyPoolGenerations,selectCompiledFamilyGeneration,getCompiledFamilyEvmRelease} from './family-network.mjs';
import {createVantaFamilyExitHost} from './family-exit-host.mjs';
import {createVantaFamilyDepositHost} from './family-deposit-host.mjs';
import {getCompiledVantaFamilyProofResources} from './family-proof-resources.mjs';
import {isFamilyAssetSelection} from './family-funding-resources.mjs';
export function createVantaFamilyGenerationWallet({walletController,getStore,getProviders,artifactBaseUrl,fetcher,
 approveExit,submitTransaction,onProgress,signal}={}){
 if(typeof walletController?.requireWallet!=='function'||typeof getStore!=='function'||typeof getProviders!=='function')
  throw Error('Generation wallet requires the existing trusted wallet and encrypted generation journals.');
 const exits=new Map();let closed=false;
 const live=()=>{signal?.throwIfAborted();if(closed)throw Error('Generation wallet is closed.');};
 const select=input=>{live();return selectCompiledFamilyGeneration(input);};
 const setup=async context=>{
  const [store,providers]=await Promise.all([getStore(context),getProviders(context.networkId)]);live();
  if(!store?.scope?.endsWith('/'+context.networkId+'/'+context.generationId))throw Error('Generation journal differs.');
  return {walletController,store,...providers,artifactBaseUrl,fetcher,releaseContext:context,signal,onProgress};
 };
 return Object.freeze({
  generations(){live();return getCompiledFamilyPoolGenerations().map(context=>{
   const release=getCompiledFamilyEvmRelease(context),inventory=getCompiledVantaFamilyProofResources(release,context);
   return Object.freeze({...context,pools:Object.freeze(inventory.funding.pools.map(p=>Object.freeze({pool:p.pool,asset:p.asset,
    symbol:p.assetSymbol,decimals:p.assetDecimals,mode:context.mode}))) });
  });},
  async openWithdrawal({networkId,generationId,asset='native'}={}){
   const context=select({networkId,generationId});if(!isFamilyAssetSelection(asset))throw Error('Unknown pool asset.');
   const key=networkId+'/'+context.generationId+'/'+asset;
   let pending=exits.get(key);
   if(!pending){pending=(async()=>{const options=await setup(context);
    const host=await createVantaFamilyExitHost({...options,asset,approveExit,submitTransaction});
    if(closed){host.dispose();live();}return host;})();exits.set(key,pending);pending.catch(()=>{if(exits.get(key)===pending)exits.delete(key);});}
   return pending;
  },
  async openDeposit({networkId,generationId,asset='native',...hostOptions}={}){
   const context=select({networkId,generationId});
   if(context.mode!=='active')throw Error('This pool generation is withdrawal-only. New deposits use the active generation.');
   // Callbacks belong to the trusted wallet host; compiled context/options
   // cannot be replaced by fields supplied in a deposit request.
   return createVantaFamilyDepositHost({...hostOptions,...await setup(context),asset});
  },
  dispose(){closed=true;for(const host of exits.values())host.then(h=>h.dispose()).catch(()=>{});exits.clear();},
 });
}
