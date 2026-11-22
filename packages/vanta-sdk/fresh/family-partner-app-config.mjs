import {getAddress} from 'ethers';
import {getCompiledFamilyEvmRelease} from './family-network.mjs';
import {getCompiledVantaFamilyProofResources} from './family-proof-resources.mjs';
import {verifyPartnerAssetConfigurationCore} from './family-partner-app-config-core.mjs';
export async function verifyVantaFamilyPartnerAssetConfiguration(options){
 const release=getCompiledFamilyEvmRelease(options.releaseContext),inventory=getCompiledVantaFamilyProofResources(release,options.releaseContext);
 return verifyPartnerAssetConfigurationCore({...options,release,inventory});
}
export function createVantaFamilyPartnerAssetConfiguration({provider,verificationProvider,url,handleId,releaseContext,fetcher=globalThis.fetch,onChange}={}){
 if(!/^0x[0-9a-f]{64}$/iu.test(handleId??'')||typeof url!=='string'||new URL(url).protocol!=='https:')throw Error('An HTTPS partner configuration URL is required.');
 let current;
 return Object.freeze({
  async refresh(){const response=await fetcher(url,{cache:'no-store',redirect:'error'});if(!response.ok)throw Error('Partner asset settings are unavailable.');
   const text=await response.text();if(text.length>16384)throw Error('Partner configuration exceeds its limit.');
   const authorization=JSON.parse(text).authorization,verified=await verifyVantaFamilyPartnerAssetConfiguration({authorization,provider,verificationProvider,releaseContext,allowExpired:true});
   if(verified.handleId.toLowerCase()!==handleId.toLowerCase())throw Error('Configuration belongs to another partner.');
   if(current&&(verified.handleId!==current.handleId||BigInt(verified.revision)<BigInt(current.revision)))throw Error('Partner configuration rollback or identity change.');
   current=verified;onChange?.(verified);return verified;},
  current:()=>current,
  requireAsset(asset,{operation}={}){
   const release=getCompiledFamilyEvmRelease(releaseContext),inventory=getCompiledVantaFamilyProofResources(release,releaseContext),address=asset==='native'?'0x'+'00'.repeat(20):getAddress(asset).toLowerCase();
   if(!inventory.funding.pools.some(p=>p.asset.toLowerCase()===address))throw Error('Asset is outside the signed SDK inventory.');
   // App visibility must never block recovery or withdrawals from known pools.
   if(['withdraw','enhanced-withdraw','recover','receive-existing'].includes(operation))return true;
   if(!current?.visibleAssets.includes(address))throw Error('This asset is not enabled for new activity in this app.');return true;
  }
 });
}
