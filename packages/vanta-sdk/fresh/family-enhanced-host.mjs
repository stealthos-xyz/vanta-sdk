/** Current KZG/ordinary-Groth16 wallet composition. Signed resources and two
 * independent RPCs are verified before the existing privacy vault is opened.
 * The pre-ceremony package embeds no activation or production proving keys. */
import {Interface,getAddress} from "ethers";
import {getSharedConfirmedBlock} from './transaction-confirmations.mjs';
import {getCompiledFamilyEvmRelease,verifyCompiledFamilyOperationRuntime} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources} from "./family-proof-resources.mjs";
import {selectVantaFamilyFundingResources} from "./family-funding-resources.mjs";
import {createVantaFamilyEnhancedRelayTransport} from "./family-enhanced-relay.mjs";
import {createVantaEnhancedCandidateHost} from "./family-enhanced-runtime.mjs";
const POOL=new Interface(["function asset() view returns(address)","function maximumWindowEpochs() view returns(uint64)",
  "function minimumDelayEpochs() view returns(uint64)","function maximumAuthorizationAgeEpochs() view returns(uint64)"]);
export async function createVantaFamilyEnhancedHost({walletController,store,provider,verificationProvider,relayerUrl,
  walletAddress,signConsent,artifactBaseUrl,fetcher,journalStore,getSession,signal,onProgress,asset="native",releaseContext}={}){
  if(typeof walletController?.requireWallet!=="function"||!store||!provider||!verificationProvider||provider===verificationProvider||
    typeof getSession!=="function")throw Error("Enhanced host requires trusted wallet, session and RPC adapters.");
  getAddress(walletAddress);signal?.throwIfAborted();
  const release=getCompiledFamilyEvmRelease(releaseContext),inventory=getCompiledVantaFamilyProofResources(release,releaseContext);
  const resources=selectVantaFamilyFundingResources(release,inventory,asset),d=resources.deployment;
  const verifyOperation=async()=>{
  await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,d.pool,releaseContext)));
  const confirmed=await getSharedConfirmedBlock(provider,verificationProvider);
  await Promise.all(["asset","maximumWindowEpochs","minimumDelayEpochs","maximumAuthorizationAgeEpochs"].map(async method=>{
    const tx={to:d.pool,data:POOL.encodeFunctionData(method),blockTag:confirmed.number};
    const [a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
    if(a.toLowerCase()!==b.toLowerCase())throw Error("Independent enhanced host policy reads disagree.");
    const [value]=POOL.decodeFunctionResult(method,a);
    if(method==="asset"?getAddress(value)!==getAddress(d.asset):BigInt(value)!==BigInt(d.hostPolicy[method==="maximumWindowEpochs"?"windowEpochs":method]))
      throw Error("Compiled enhanced host policy differs from its pool.");
  }));
  };
  signal?.throwIfAborted();
  const context={networkId:release.pins.networkId,generationId:release.pins.generationId,pool:d.pool,assetAddress:d.asset};
  const relay=createVantaFamilyEnhancedRelayTransport({relayerUrl,context,walletAddress,signConsent,store,fetcher,signal,releaseContext});
  const guardedRelay=Object.freeze({...relay,async submit(...args){await verifyOperation();return relay.submit(...args);}});
  try{
    const result=await createVantaEnhancedCandidateHost({wallet:walletController.requireWallet(),store,provider,verificationProvider,
      relay:guardedRelay,artifactBaseUrl,fetcher,journalStore,getSession,signal,onProgress,asset,releaseContext});
    const guard=api=>Object.freeze({...api,...Object.fromEntries(['prepare','execute'].filter(k=>typeof api[k]==='function').map(k=>[k,async(...args)=>{await verifyOperation();return api[k](...args);}]))});
    return Object.freeze({...result,host:guard(result.host),publicBatch:guard(result.publicBatch),quoteWithdrawal:result.quoteWithdrawal,prepareReviewedWithdrawal:result.prepareReviewedWithdrawal});
  }
  catch(error){relay.dispose();throw error;}
}
