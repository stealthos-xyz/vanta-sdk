import {JsonRpcProvider} from 'ethers';
// One endpoint is one trust source. Share identical reads instead of claiming
// independent assurance from two clients backed by that same RPC.
const aliases=new WeakMap();
export const canonicalFamilyProvider=provider=>aliases.get(provider)||provider;
export function createFamilyRpcProviders(primaryUrl,verificationUrl,chainId){
 const parse=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('An HTTPS family RPC is required.');return u.href;};
 const primary=parse(primaryUrl),secondary=parse(verificationUrl),provider=new JsonRpcProvider(primary,chainId);
 if(primary!==secondary)return {provider,verificationProvider:new JsonRpcProvider(secondary,chainId),mode:'independent'};
 const verificationProvider=new Proxy(provider,{get(target,key){if(key==='destroy')return ()=>{};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 aliases.set(verificationProvider,provider);return {provider,verificationProvider,mode:'single-endpoint'};
}
