/** Optional persistent cache of immutable PUBLIC proving artifacts only.
 * Cache entries never authorize a release or transaction: every read is checked
 * against the compiled SHA-256 and size before immutable bytes are retained in
 * bounded worker memory. No notes, witnesses or wallet keys enter it. */
import {sha256} from 'ethers';
const LIMIT=64*1024*1024;
export function depositWarmupPins(inventory){
 const p=inventory.profiles.combined,policy=inventory.partnerPolicyKzg;
 return [p.runtime.glue,p.runtime.wasm,p.keyManifest,p.matrixManifest,p.fixedKey,p.matrix,
  ...Object.values(p.queries),p.policyLookupKey,inventory.profiles.normal8.runtime.glue,
  inventory.profiles.normal8.runtime.wasm,policy.corpus,policy.corpusMetadata].filter(Boolean);
}
export function walletWarmupPins(inventory){
 const c=inventory.funding.publicCache;
 const pins=[...depositWarmupPins(inventory),...['normal8','normal32'].flatMap(name=>{const p=inventory.profiles[name];return p?[p.runtime.glue,p.runtime.wasm,p.m2Manifest,p.matrixManifest,p.publicMaterial,p.m2Key,p.matrix]:[];}),
  c.corpus,c.metadata,c.runtime.glue,c.runtime.wasm,c.runtime.build];
 return [...new Map(pins.filter(Boolean).map(p=>[p.sha256+':'+p.bytes,p])).values()];
}
export function enhancedWarmupPins(inventory){
 const profile=inventory.profiles.enhanced;
 return [profile.keyManifest,profile.matrixManifest,profile.fixedKey,profile.policyLookupKey,
  profile.matrix,...Object.values(profile.queries)].filter(Boolean);
}
export function createFamilyPublicArtifactCache({baseUrl,pins,enhancedPins=[],fetcher=fetch,cacheStorage=globalThis.caches,locks=globalThis.navigator?.locks}={}){
 const base=new URL(baseUrl),allowed=new Map(),inflight=new Map(),memory=new Map();let memoryBytes=0;
 const remember=(url,bytes)=>{
  const bound=32*1024*1024;if(bytes.byteLength>bound)return bytes;
  const old=memory.get(url);if(old){memory.delete(url);memoryBytes-=old.byteLength;}
  while(memoryBytes+bytes.byteLength>bound){const key=memory.keys().next().value;memoryBytes-=memory.get(key).byteLength;memory.delete(key);}
  memory.set(url,bytes);memoryBytes+=bytes.byteLength;return bytes;
 };
 const register=pin=>{
  const hash=pin.sha256?.replace(/^0x/u,'');
  if(!/^[0-9a-f]{64}$/u.test(hash)||!Number.isSafeInteger(pin.bytes)||pin.bytes<1||pin.bytes>LIMIT)throw Error('Invalid pinned public cache artifact.');
  const url=new URL(pin.path,base);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw Error('Public cache artifact escaped its origin.');
  allowed.set(url.href,{...pin,hash});
  return url.href;
 };
 const startupUrls=pins.map(register),enhancedUrls=enhancedPins.map(register);
 const valid=(bytes,pin)=>bytes.length===pin.bytes&&sha256(bytes)==='0x'+pin.hash;
 const response=(bytes,pin)=>new Response(bytes,{status:200,headers:{'Content-Length':String(pin.bytes),'Content-Type':pin.path.endsWith('.mjs')?'text/javascript':'application/octet-stream'}});
 const load=async(url,pin,init)=>{
  const work=async()=>{
   let cache;try{cache=await cacheStorage?.open('stealthos-public-proof-artifacts-v1');}catch{}
   const key=new Request(new URL('/'+pin.hash+'/'+pin.bytes,base.origin));
   try{const hit=await cache?.match(key);if(hit){const bytes=new Uint8Array(await hit.arrayBuffer());if(valid(bytes,pin))return remember(url,bytes);await cache.delete(key);}}catch{}
   let res;
   for(let attempt=0;attempt<2;attempt++){
    init?.signal?.throwIfAborted();
    try{res=await fetcher(url,{...init,method:'GET',headers:undefined,credentials:'omit',redirect:'error',cache:attempt?'reload':'force-cache'});}
    catch(error){if(attempt||init?.signal?.aborted)throw error;continue;}
    if(attempt===0&&[429,502,503,504].includes(res.status)){await res.body?.cancel();continue;}
    break;
   }
   if(res.status!==200||res.redirected||res.type==='opaque'||!res.body)throw Error('Family public artifact: download unavailable.');
   const bytes=new Uint8Array(pin.bytes),reader=res.body.getReader();let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;if(size+part.value.length>bytes.length)throw Error('Family public artifact: oversized download.');bytes.set(part.value,size);size+=part.value.length;}
    if(size!==pin.bytes||!valid(bytes,pin))throw Error('Family public artifact: SHA-256 or size differs.');
   }catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
   try{await cache?.put(key,response(bytes,pin));}catch{}return remember(url,bytes);
  };
  return locks?.request?locks.request('stealthos-public-'+pin.hash,work):work();
 };
 const bytes=(url,pin,init)=>{
  const hit=memory.get(url);if(hit){memory.delete(url);memory.set(url,hit);return Promise.resolve(hit);}
  let task=inflight.get(url);if(!task){task=load(url,pin,init);inflight.set(url,task);task.finally(()=>{if(inflight.get(url)===task)inflight.delete(url);}).catch(()=>{});}return task;
 };
 const cachedFetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const pin=allowed.get(url),method=init?.method??(input instanceof Request?input.method:'GET');
  if(!pin||method!=='GET')return fetcher(input,init);
  const range=new Headers(init?.headers??(input instanceof Request?input.headers:undefined)).get('Range');
  if(range){const m=/^bytes=(\d+)-(\d+)$/u.exec(range);if(!m)return fetcher(input,init);
   const start=Number(m[1]),end=Number(m[2]);if(start>end||end>=pin.bytes)return fetcher(input,init);
   const full=await bytes(url,pin,init);return new Response(full.slice(start,end+1),{status:206,headers:{'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${pin.bytes}`}});
  }
  return response(await bytes(url,pin,init),pin);
 };
 const warm=async urls=>{for(const url of urls)await bytes(url,allowed.get(url));};
 let warmingEnhanced;
 return Object.freeze({
  fetch:cachedFetch,
  warm:()=>warm(startupUrls),
  // Quotes with edited inputs share the same immutable proof files. Keep one
  // background download at a time and let proving reuse any in-flight read.
  warmEnhanced(){
   warmingEnhanced??=warm(enhancedUrls).finally(()=>{warmingEnhanced=undefined;});
   return warmingEnhanced;
  },
 });
}
