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
