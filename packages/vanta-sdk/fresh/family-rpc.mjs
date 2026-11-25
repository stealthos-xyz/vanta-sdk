import {FetchRequest,JsonRpcProvider} from 'ethers';

// One active trust source. The legacy verification adapter aliases it;
// it must never be described as independent corroboration.
const aliases=new WeakMap();
export const canonicalFamilyProvider=provider=>aliases.get(provider)||provider;
const reads=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_call','eth_getLogs','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBalance','eth_getTransactionCount','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_estimateGas','eth_getStorageAt']);
const errors=e=>[e,e?.error,e?.info?.error,e?.cause,e?.cause?.info?.error];
export function isFamilyLogRangeLimit(error){
 return errors(error).some(e=>e?.code===-32062||/block range (?:is )?too large|(?:maximum|max) (?:allowed )?block range|(?:block range|range of blocks) (?:limit|exceeds)|query returned more than/iu.test(e?.message??''));
}
const rate=e=>!isFamilyLogRangeLimit(e)&&errors(e).some(v=>v?.code===429||v?.code===-32005||/rate.?limit|too many requests/iu.test(v?.message??''));
const httpStatus=e=>Number(e?.response?.statusCode??e?.info?.responseStatus??e?.status??e?.statusCode);
const transport=e=>!isFamilyLogRangeLimit(e)&&(rate(e)||e?.code==='TIMEOUT'||e?.code==='NETWORK_ERROR'&&e?.event!=='changed'||[408,429,500,502,503,504].includes(httpStatus(e))||/failed to fetch|network request failed|fetch failed|connection reset|socket hang up/iu.test(e?.message??''));
const batchRejected=e=>[400,413].includes(httpStatus(e))||errors(e).some(v=>/batch.{0,40}(?:not supported|disabled|too large|limit|invalid)|(?:unsupported|invalid) batch/iu.test(v?.message??''));
export async function readFamilyLogWindow({fromBlock,anchorBlock,chunkBlocks=1000,read}){
 if(!Number.isSafeInteger(fromBlock)||fromBlock<0||!Number.isSafeInteger(anchorBlock)||anchorBlock<fromBlock||!Number.isSafeInteger(chunkBlocks)||chunkBlocks<1)throw Error('Invalid canonical log window.');
 for(;;){
  const toBlock=Math.min(anchorBlock,fromBlock+chunkBlocks-1);
  try{return {toBlock,chunkBlocks,value:await read(fromBlock,toBlock)};}
  catch(error){if(toBlock===fromBlock||!isFamilyLogRangeLimit(error))throw error;chunkBlocks=Math.floor((toBlock-fromBlock+1)/2);}
 }
}
export async function readFamilyLogRange(provider,filter){
 if(!Number.isSafeInteger(filter.fromBlock)||!Number.isSafeInteger(filter.toBlock)||filter.fromBlock<0)throw Error('Invalid canonical log range.');
 const logs=[];let from=filter.fromBlock,chunkBlocks=1000;
 while(from<=filter.toBlock){
  const w=await readFamilyLogWindow({fromBlock:from,anchorBlock:filter.toBlock,chunkBlocks,read:(fromBlock,toBlock)=>provider.getLogs({...filter,fromBlock,toBlock})});
  for(const log of w.value)logs.push(log);
  from=w.toBlock+1;chunkBlocks=w.chunkBlocks;
 }
 return logs;
}
const request=url=>{const r=new FetchRequest(url);r.timeout=8000;r.setThrottleParams({maxAttempts:1});return r;};
const parse=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('A credential-free HTTPS family RPC is required.');return u.href;};
// Log requests are never batched together. Other reads use small batches;
// explicit batch rejection falls back to individual primary requests.
export async function routeFamilyRpcPayload(payload,primary,backup){
 const items=Array.isArray(payload)?payload:[payload];
 if(items.length>1&&items.some(p=>p.method==='eth_getLogs'||!reads.has(p.method)))return (await Promise.all(items.map(p=>routeFamilyRpcPayload(p,primary,backup)))).flat();
 let result;
 try{result=await primary(payload);}
 catch(error){
  if(items.length>1&&batchRejected(error))return (await Promise.all(items.map(p=>routeFamilyRpcPayload(p,primary,backup)))).flat();
  if(!backup||!items.every(p=>reads.has(p.method))||!transport(error))throw error;
  return backup(payload);
 }
 if(items.length>1&&result.some(r=>r.error&&batchRejected(r.error)))return (await Promise.all(items.map(p=>routeFamilyRpcPayload(p,primary,backup)))).flat();
 if(!backup)return result;
 return Promise.all(result.map(async r=>{
  const item=items.find(p=>p.id===r.id);
  if(!item||!reads.has(item.method)||!r.error||!rate(r.error))return r;
  const retried=await backup(item);if(retried.length!==1||retried[0].id!==item.id)throw Error('Fallback RPC response differs.');
  return retried[0];
 }));
}
class FamilyReadProvider extends JsonRpcProvider{
 constructor(primary,secondary,chainId,genesisHash){
  super(request(primary),chainId,{batchMaxCount:8,batchStallTime:0});
  this.chainId=BigInt(chainId);this.genesisHash=genesisHash;
  this.secondary=secondary?new JsonRpcProvider(request(secondary),chainId,{batchMaxCount:1}):null;
 }
 async _send(payload){
  const primary=p=>super._send(p);
  const backup=this.secondary?async p=>{
   // Check signed network identity before trusting a fallback response.
   this.checking??=Promise.all([
    this.secondary._send({jsonrpc:'2.0',id:0,method:'eth_chainId',params:[]}),
    this.secondary._send({jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['0x0',false]})
   ]).then(([chain,genesis])=>{
    if(chain[0]?.id!==0||genesis[0]?.id!==1||BigInt(chain[0]?.result??-1)!==this.chainId||genesis[0]?.result?.hash?.toLowerCase()!==this.genesisHash)throw Error('Fallback RPC belongs to a different network.');
   }).finally(()=>{this.checking=undefined;});
   await this.checking;
   if(Array.isArray(p))return (await Promise.all(p.map(item=>this.secondary._send(item)))).flat();
   return this.secondary._send(p);
  }:undefined;
  return routeFamilyRpcPayload(payload,primary,backup);
 }
 destroy(){this.secondary?.destroy();super.destroy();}
}
const coalesced=new Set(['getNetwork','getBlock','getCode','call','getLogs','getTransaction','getTransactionReceipt','getBalance','getTransactionCount','getFeeData','estimateGas','getStorage','getBlockNumber']);
function coalesce(provider){
 const pending=new Map();
 return new Proxy(provider,{get(target,key){
  const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
  if(!coalesced.has(key))return value.bind(target);
  return (...args)=>{
   // Restrict deduplication to serializable plain RPC arguments. ENS objects,
   // promises and other custom inputs are not interchangeable.
   const plain=v=>v==null||['string','number','boolean','bigint','undefined'].includes(typeof v)||Array.isArray(v)&&v.every(plain)||typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&Object.values(v).every(plain);
   if(!args.every(plain))return value.apply(target,args);
   const id=JSON.stringify([key,args],(_,v)=>typeof v==='bigint'?['bigint',v.toString()]:v);
   if(pending.has(id))return pending.get(id);
   const work=Promise.resolve().then(()=>value.apply(target,args)).finally(()=>pending.delete(id));
   pending.set(id,work);return work;
  };
 }});
}
export function createFamilyRpcProviders(primaryUrl,verificationUrl,chainId,genesisHash){
 const primary=parse(primaryUrl),secondary=parse(verificationUrl);
 if(primary!==secondary&&!/^0x[0-9a-f]{64}$/iu.test(genesisHash??''))throw Error('A signed genesis pin is required for fallback RPC.');
 const provider=coalesce(new FamilyReadProvider(primary,primary===secondary?null:secondary,chainId,genesisHash?.toLowerCase()));
 const verificationProvider=new Proxy(provider,{get(target,key){if(key==='destroy')return ()=>{};return Reflect.get(target,key,target);}});
 aliases.set(verificationProvider,provider);
 return {provider,verificationProvider,mode:primary===secondary?'single-endpoint':'primary-fallback'};
}
export function resolvePartnerRpcEndpoints(primaryUrl,verificationRpcUrl){
 const primary=new URL(parse(primaryUrl));
 if(verificationRpcUrl===undefined)return Object.freeze({primary:primary.href,verification:primary.href,mode:'single-endpoint'});
 const secondary=new URL(parse(verificationRpcUrl));
 if(primary.origin===secondary.origin)throw Error('Fallback RPC must use a distinct origin.');
 return Object.freeze({primary:primary.href,verification:secondary.href,mode:'primary-fallback'});
}
