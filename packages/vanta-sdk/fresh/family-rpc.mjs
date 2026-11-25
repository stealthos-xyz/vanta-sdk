import {JsonRpcProvider} from 'ethers';
// One endpoint is one trust source. Share identical reads instead of claiming
// independent assurance from two clients backed by that same RPC.
const aliases=new WeakMap();
export const canonicalFamilyProvider=provider=>aliases.get(provider)||provider;
export function createFamilyRpcProviders(primaryUrl,verificationUrl,chainId){
 const parse=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('An HTTPS family RPC is required.');return u.href;};
 // Providers can cap the sum of log ranges in an HTTP batch. Use individual
 // JSON-RPC requests even when the browser verifies several pools concurrently.
 const primary=parse(primaryUrl),secondary=parse(verificationUrl),options={batchMaxCount:1},provider=new JsonRpcProvider(primary,chainId,options);
 if(primary!==secondary)return {provider,verificationProvider:new JsonRpcProvider(secondary,chainId,options),mode:'independent'};
 const verificationProvider=new Proxy(provider,{get(target,key){if(key==='destroy')return ()=>{};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 aliases.set(verificationProvider,provider);return {provider,verificationProvider,mode:'single-endpoint'};
}

// Older consumers can retain one RPC without claiming independent assurance.
// An explicitly supplied second provider must use a different HTTPS origin.
export function resolvePartnerRpcEndpoints(primaryUrl,verificationRpcUrl){
 const checked=value=>{if(typeof value!=='string'||!value)throw Error('A credential-free HTTPS RPC is required.');const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('A credential-free HTTPS RPC is required.');return u;};
 const primary=checked(primaryUrl);
 if(verificationRpcUrl===undefined)return Object.freeze({primary:primary.href,verification:primary.href,mode:'single-endpoint'});
 const secondary=checked(verificationRpcUrl);
 if(primary.origin===secondary.origin)throw Error('Independent verification RPC must use a distinct origin.');
 return Object.freeze({primary:primary.href,verification:secondary.href,mode:'independent-endpoint'});
}
