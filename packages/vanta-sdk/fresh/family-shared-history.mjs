import history from './generated-family-history-checkpoint.mjs';
import {hexlify} from 'ethers';
const MAX_HISTORY_BYTES=8*1024*1024;
const decoded=new Map();
async function decode(entry){
 if(!entry||!Number.isSafeInteger(entry.rawBytes)||entry.rawBytes<1||entry.rawBytes>MAX_HISTORY_BYTES||
    !/^[a-f0-9]{64}$/u.test(entry.sha256)||typeof entry.gzipBase64!=='string'||
    entry.gzipBase64.length>MAX_HISTORY_BYTES*2||typeof DecompressionStream!=='function')return undefined;
 const bytes=Uint8Array.from(atob(entry.gzipBase64),char=>char.charCodeAt(0));
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const raw=new Uint8Array(entry.rawBytes);let offset=0;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;
   if(offset+value.byteLength>raw.length)throw Error('Public history exceeds its signed size.');
   raw.set(value,offset);offset+=value.byteLength;
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(offset!==raw.length||hexlify(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)))!=='0x'+entry.sha256)return undefined;
 return JSON.parse(new TextDecoder().decode(raw));
}
/** A release-bound, public-only checkpoint. No address or key is sent to a
 * service. The caller must validate the independent canonical chain anchor. */
export async function readSharedFamilyHistory(context,deploymentBlock,afterBlock){
 if(history.schema!=='vanta-family-public-history-checkpoint-v1'||
    history.networkId!=='eip155:'+context.chainId||history.generationId!==context.generationId||
    !Number.isSafeInteger(history.anchor?.number)||history.anchor.number<deploymentBlock||
    history.anchor.number<=(afterBlock??-1)||!/^0x[0-9a-f]{64}$/u.test(history.anchor.hash))return undefined;
 const pool=context.pool,entry=history.pools[pool];if(!entry)return undefined;
 if(!decoded.has(pool))decoded.set(pool,decode(entry).catch(()=>undefined));
 const result=await decoded.get(pool);
 if(result?.anchor?.number!==history.anchor.number||result.anchor.hash!==history.anchor.hash)return undefined;
 return result;
}

const LIVE_URL='https://stealthos-dogeos-chikyu-data-api.onrender.com/public/v1/vanta-history';
const LIVE_KEY='MCowBQYDK2VwAyEA7Et0DY3E8uugxphIE1IxCDgTdyNEvnLhiS768AhLYVY=';
const LIVE_SCHEMA='vanta-family-live-public-history-v1',LIVE_DOMAIN='STEALTHOS_VANTA_PUBLIC_HISTORY_V1';
const b64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const fresh=(value,now)=>Number.isSafeInteger(value?.issuedAt)&&value.issuedAt<=now/1000+30&&value.issuedAt>=now/1000-180;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const field=/^0x[0-9a-f]{64}$/u;
const expectedPools=Object.keys(history.pools).sort();
const domainMatches=(value,context)=>value?.networkId==='eip155:'+context.chainId&&value.generationId===context.generationId&&value.genesisHash===context.genesisHash&&value.setupId===context.setupId;
const entryValid=entry=>exact(entry,['rawBytes','sha256','gzipBase64'])&&Number.isSafeInteger(entry.rawBytes)&&entry.rawBytes>0&&entry.rawBytes<=MAX_HISTORY_BYTES&&/^[0-9a-f]{64}$/u.test(entry.sha256)&&typeof entry.gzipBase64==='string'&&entry.gzipBase64.length<=MAX_HISTORY_BYTES*2;

/** The signed SDK pins a dedicated history-only publisher, not a spending or fee key. */
export async function verifyLiveFamilyHistoryPublication(value,context,{now=Date.now(),publicKey=LIVE_KEY}={}){
 if(!exact(value,['schema','networkId','generationId','genesisHash','setupId','anchor','issuedAt','pools','signature'])||
  value.schema!==LIVE_SCHEMA||!domainMatches(value,context)||!fresh(value,now)||
  !exact(value.anchor,['number','hash'])||!Number.isSafeInteger(value.anchor.number)||value.anchor.number<0||!field.test(value.anchor.hash)||
  !exact(value.pools,expectedPools)||!expectedPools.every(pool=>entryValid(value.pools[pool]))||
  typeof value.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/u.test(value.signature))return false;
 const bytes=new TextEncoder().encode(JSON.stringify([LIVE_DOMAIN,value.networkId,value.generationId,value.genesisHash,value.setupId,value.anchor.number,value.anchor.hash,value.issuedAt,expectedPools.map(pool=>[pool,value.pools[pool].rawBytes,value.pools[pool].sha256])]));
 try{
  const key=await crypto.subtle.importKey('spki',b64(publicKey),{name:'Ed25519'},false,['verify']);
  return await crypto.subtle.verify({name:'Ed25519'},key,b64(value.signature),bytes);
 }catch{return false;}
}
async function boundedPublication(response){
 if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('application/json')||
  Number(response.headers.get('content-length')??0)>MAX_HISTORY_BYTES)return undefined;
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>MAX_HISTORY_BYTES)return undefined;chunks.push(value);
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const raw=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
}
/** One anonymous public fetch per wallet runtime per minute; all assets share
 * the same publication. Local and bundled checkpoints remain fallbacks. */
export function createLiveFamilyHistoryReader({fetcher=globalThis.fetch,now=Date.now,publicKey=LIVE_KEY}={}){
 let current,pending,nextAttempt=0;const decodedLive=new Map();
 const load=async context=>{
  if(now()>=nextAttempt&&!pending){
   nextAttempt=now()+15000;
   pending=(async()=>{
    try{
     const response=await fetcher(LIVE_URL,{method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(5000)});
     const value=await boundedPublication(response);
     if(!await verifyLiveFamilyHistoryPublication(value,context,{now:now(),publicKey}))return;
     if(current&&current.anchor.number>value.anchor.number)return;
     current=value;decodedLive.clear();nextAttempt=now()+60000;
    }catch{/* Publisher unavailable or signature runtime unsupported: use the bundled seed. */}
   })().finally(()=>{pending=undefined;});
  }
  if(pending)await pending;
  return fresh(current,now())&&domainMatches(current,context)?current:undefined;
 };
 return async(context,deploymentBlock,afterBlock)=>{
  if(history.networkId!=='eip155:'+context.chainId||history.generationId!==context.generationId||!expectedPools.includes(context.pool))return undefined;
  const value=await load(context);
  if(!value||value.anchor.number<deploymentBlock||value.anchor.number<=(afterBlock??-1))return undefined;
  const key=context.pool;
  if(!decodedLive.has(key))decodedLive.set(key,decode(value.pools[key]).catch(()=>undefined));
  const result=await decodedLive.get(key);
  if(result?.anchor?.number!==value.anchor.number||result.anchor.hash!==value.anchor.hash)return undefined;
  return result;
 };
}
