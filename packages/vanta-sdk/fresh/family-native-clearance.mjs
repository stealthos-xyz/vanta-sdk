/** StealthOS native screening clearance. No partner server or transaction quote. */
import {AbiCoder,Interface,getAddress,verifyTypedData} from 'ethers';
export const NATIVE_CLEARANCE_TYPES=Object.freeze({NativeWalletClearance:[['wallet','address'],['validAfter','uint64'],['validUntil','uint64'],['walletRevision','uint64'],['policyRevision','uint64'],['policyHash','bytes32']].map(([name,type])=>({name,type}))});
export const NATIVE_CLEARANCE_ABI=new Interface(['function signer() view returns(address)','function policyHash() view returns(bytes32)',
 'function walletRevision(address) view returns(uint64)','function policyRevision() view returns(uint64)','function requireClearance(address,bytes) view','function internalSwapIngressUsesProvenanceOnly() view returns(bool)']);
const coder=AbiCoder.defaultAbiCoder(),cache=new Map(),inflight=new Map(),same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export function verifyNativeWalletClearance({response:r,chainId,generationId,verifier,payer,signer,policyHash,walletRevision,policyRevision,timestamp}){
 const fields=['wallet','validAfter','validUntil','walletRevision','policyRevision'],c=r?.clearance;
 if(!r||Object.keys(r).sort().join()!==['chainId','generationId','verifier','policyHash','clearance','signature'].sort().join()||
  r.chainId!==chainId||!same(r.generationId,generationId)||!same(r.verifier,verifier)||!same(r.policyHash,policyHash)||
  !c||Object.keys(c).sort().join()!==fields.slice().sort().join()||!same(c.wallet,payer)||
  ![c.validAfter,c.validUntil,c.walletRevision,c.policyRevision].every(Number.isSafeInteger)||
  c.validAfter<0||c.validAfter>timestamp||c.validUntil<=timestamp+30||c.validUntil-c.validAfter>3600||
  BigInt(c.walletRevision)!==BigInt(walletRevision)||BigInt(c.policyRevision)!==BigInt(policyRevision)||
  !/^0x[0-9a-f]{130}$/iu.test(r.signature??''))throw Error('Native wallet clearance differs from this wallet or release.');
 const recovered=verifyTypedData({name:'StealthOS Native Screening',version:'1',chainId,verifyingContract:verifier},NATIVE_CLEARANCE_TYPES,{...c,policyHash},r.signature);
 if(!same(recovered,signer))throw Error('Native wallet clearance signer differs.');
 return Object.freeze({validUntil:c.validUntil,encoded:coder.encode(['tuple(address wallet,uint64 validAfter,uint64 validUntil,uint64 walletRevision,uint64 policyRevision)','bytes'],[c,r.signature])});
}
export async function requireNativeWalletClearance({release,payer,verifier,read,timestamp,serviceUrl,fetcher=fetch,signal,privateSwapCreditId,refreshReadContext}){
 payer=getAddress(payer);verifier=getAddress(verifier);
 const observe=async fresh=>{
  const at=fresh?await refreshReadContext():{read,timestamp};
  const [signer,policyHash,walletRevision,policyRevision]=await Promise.all([
   at.read(verifier,NATIVE_CLEARANCE_ABI,'signer',[]),at.read(verifier,NATIVE_CLEARANCE_ABI,'policyHash',[]),
   at.read(verifier,NATIVE_CLEARANCE_ABI,'walletRevision',[payer]),at.read(verifier,NATIVE_CLEARANCE_ABI,'policyRevision',[])]);
  return{chainId:Number(release.pins.networkId.split(':')[1]),generationId:release.pins.generationId,verifier,payer,
   signer:signer[0],policyHash:policyHash[0],walletRevision:walletRevision[0],policyRevision:policyRevision[0],timestamp:at.timestamp};
 };
 let context=await observe(Boolean(refreshReadContext));
 const key=[context.chainId,context.generationId,verifier,payer].join(':').toLowerCase();
 const old=cache.get(key);if(old){try{return verifyNativeWalletClearance({...context,response:old});}catch{cache.delete(key);}}
 let request=inflight.get(key);if(!request){request=(async()=>{
  const response=await fetcher(new URL('/api/vanta-v8/deposit/clearance',serviceUrl),{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({payer,...(privateSwapCreditId?{privateSwapCreditId}:{})}),signal});
  if(Number(response.headers.get('content-length')??0)>8192)throw Error('Native clearance response exceeds its limit.');
  const text=await response.text();if(text.length>8192)throw Error('Native clearance response exceeds its limit.');
  if(!response.ok)throw Error(response.status===429?'Native wallet screening is still running. Please retry shortly.':'Native wallet screening clearance is unavailable.');
  return JSON.parse(text);
 })();inflight.set(key,request);request.finally(()=>inflight.delete(key)).catch(()=>{});}
 const response=await request;
 // Screening may finish after the caller's original block. Re-observe the
 // confirmed time AND all revocation/signer state before accepting its result.
 if(refreshReadContext)context=await observe(true);
 const result=verifyNativeWalletClearance({...context,response});
 if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,response);return result;
}
