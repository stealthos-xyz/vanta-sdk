/** One durable, encrypted session drives independently authorized asset
 * transactions. It never resends an ambiguous submission on reconnect. */
import {getAddress,id,toBeHex} from 'ethers';
import {getSharedConfirmedBlock} from './transaction-confirmations.mjs';
const NAME='family-partner-signup-v2',SCHEMA='vanta-family-partner-assets-v1',HASH=/^0x[0-9a-f]{64}$/iu;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const fail=m=>{throw Error('Partner assets: '+m);};
const encode=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{$bigint:x.toString()}:x);
const decode=v=>JSON.parse(v,(_,x)=>{if(x&&typeof x==='object'&&Object.keys(x).join()==='$bigint'){
 if(typeof x.$bigint!=='string'||!/^(0|[1-9][0-9]{0,77})$/u.test(x.$bigint))fail('invalid saved integer');return BigInt(x.$bigint);}return x;});
const feesOf=v=>{
 if(!Array.isArray(v)||v.length!==6)fail('six operation fees are required');
 return v.map(f=>{
  if(!f||!Number.isInteger(f.feeBps)||f.feeBps<0||f.feeBps>10000||typeof f.minimumFee!=='bigint'||typeof f.maximumFee!=='bigint'||
    f.minimumFee<0n||f.maximumFee<f.minimumFee||f.maximumFee>=(1n<<120n)||(f.feeBps===0?f.minimumFee!==f.maximumFee:f.maximumFee===0n))fail('invalid fee bounds');
  return {feeBps:f.feeBps,minimumFee:f.minimumFee,maximumFee:f.maximumFee};
 });
};
export function createVantaFamilyPartnerAssetSignup({registry,wallet,hostWallet,store,provider,verificationProvider,onProgress}={}){
 if(registry?.assetRegistrationVersion!==3||!Array.isArray(registry.assets)||!registry.assets.length||provider===verificationProvider||
   !store?.scope?.endsWith(`/eip155:${registry.chainId}/${registry.generationId}`))fail('verified asset registry and generation-scoped encrypted store required');
 const supported=registry.assets.map(v=>getAddress(v.asset).toLowerCase()),clients=[provider,verificationProvider];let busy=false;
 const choose=raw=>{
  if(!Array.isArray(raw)||!raw.length||raw.length>supported.length)fail('select at least one supported asset');
  const addresses=raw.map(a=>a==='native'?supported[0]:getAddress(a).toLowerCase());
  if(new Set(addresses).size!==addresses.length||addresses.some(a=>!supported.includes(a)))fail('unsupported or duplicate asset');
  return supported.filter(a=>addresses.includes(a));
 };
 function checked(rows){
  if(!Array.isArray(rows)||rows.length>1)fail('invalid saved session');if(!rows.length)return null;
  const r=rows[0];
  if(!r||Object.keys(r).sort().join()!=='action,assets,claim,completed,fees,from,generationId,handle,kind,request,schema,serializedIntent,transactionHash'||
    r.schema!==SCHEMA||r.generationId!==registry.generationId||!['register','update','revoke'].includes(r.action)||
    !['preparing','handle','registration','complete'].includes(r.kind)||!/^0x[0-9a-f]{40}$/u.test(r.from)||
    !/^[a-z0-9][a-z0-9.-]{1,63}$/u.test(r.handle)||typeof r.claim!=='string'||r.claim.length>131072||
    !Array.isArray(r.completed)||r.completed.length>r.assets?.length)fail('invalid encrypted session');
  if(JSON.stringify(choose(r.assets))!==JSON.stringify(r.assets))fail('saved asset selection differs from the signed inventory');
  feesOf(decode(r.fees));
  if(r.completed.some((x,i)=>!x||x.asset!==r.assets[i]||(x.transactionHash!==null&&(!HASH.test(x.transactionHash)||BigInt(x.transactionHash)===0n))))fail('invalid completed asset checkpoints');
  const claim=decode(r.claim);if(claim.handle!==r.handle||!HASH.test(claim.handleId)||!HASH.test(claim.ownerCommitment)||!HASH.test(claim.recordCommitment))fail('invalid saved handle claim');
  if(['preparing','complete'].includes(r.kind)){
   if(r.request!==null||r.transactionHash!==null||r.serializedIntent!==null)fail('invalid preparation checkpoint');
  }else{
   const q=r.request;
   if(!q||q.chainId!==registry.chainId||!/^0x[0-9a-f]{40}$/iu.test(q.registrar)||!/^0x(?:[0-9a-f]{2})+$/iu.test(q.calldata)||
     q.calldata.length>524288||!HASH.test(q.settlementNonce)||!['4000000','8000000'].includes(q.maxGasLimit)||
     (r.transactionHash!==null&&(!HASH.test(r.transactionHash)||BigInt(r.transactionHash)===0n)))fail('invalid saved transaction');
   if(r.kind==='handle'){
    if(r.serializedIntent!==null||!same(q.registrar,claim.registry)||!same(q.calldata,claim.calldata)||!same(q.settlementNonce,claim.settlementNonce))fail('saved handle transaction changed');
   }else{
    const intent=registry.restorePending(r.serializedIntent);
    if(intent.kind!==r.action||!same(intent.request.calldata,q.calldata)||!same(intent.request.registrar,q.registrar)||
      !same(intent.request.settlementNonce,q.settlementNonce)||!same(intent.asset,r.assets[r.completed.length]))fail('saved asset authorization changed');
   }
  }
  return r;
 }
 const read=async()=>checked(await store.read(NAME));
 const write=async(old,next)=>store.transact(NAME,rows=>{const current=checked(rows);if(JSON.stringify(current)!==JSON.stringify(old))fail('another session changed this registration');return {next:next?[next]:[],result:undefined};});
 const account=async r=>{const c=await hostWallet.getContext();if(c.chainId!==registry.chainId||c.networkId!==`eip155:${registry.chainId}`||r&&!same(c.address,r.from))fail('reconnect the original wallet and network');return c;};
 function status(r){
  if(!r)return Object.freeze({status:'none'});
  const base={handle:r.handle,feeBps:decode(r.fees).map(f=>f.feeBps),assets:Object.freeze([...r.assets]),completedAssets:Object.freeze(r.completed.map(x=>x.asset)),totalAssets:r.assets.length,stage:r.kind};
  if(r.kind==='complete')return Object.freeze({...base,status:r.action==='revoke'?'revoked':'registered',generationId:registry.generationId,
   transactionHash:r.completed.findLast(x=>x.transactionHash)?.transactionHash??null});
  return Object.freeze({...base,status:r.kind==='preparing'?'preparing':r.transactionHash?'submitted':'broadcast-uncertain',transactionHash:r.transactionHash,canRecoverHash:r.kind!=='preparing'&&!r.transactionHash});
 }
 async function submitted(record,nonce){
  const context=await account(record),q=record.request;
  try{
   await hostWallet.sendTransaction({context,transaction:{from:context.address,to:q.registrar,chainId:'0x'+registry.chainId.toString(16),value:'0x0',data:q.calldata,gas:'0x'+BigInt(q.maxGasLimit).toString(16),...(nonce===undefined?{}:{nonce:'0x'+nonce.toString(16)})},
    onSubmitted:async hash=>{if(!HASH.test(hash)||BigInt(hash)===0n)fail('wallet returned no valid transaction hash');await write(record,{...record,transactionHash:hash.toLowerCase()});}});
  }catch(error){
   if(error?.code==='HOST_USER_REJECTED'){
    const latest=await read();if(latest&&latest.transactionHash===null&&latest.request?.settlementNonce===q.settlementNonce)
     await write(latest,{...latest,kind:'preparing',request:null,serializedIntent:null,transactionHash:null});
   }
   throw error;
  }
 }
 async function settle(record){
  if(!record.transactionHash)return status(record);
  const hash=record.transactionHash,q=record.request;
  const [ta,tb,ra,rb,head]=await Promise.all([provider.getTransaction(hash),verificationProvider.getTransaction(hash),
   provider.getTransactionReceipt(hash),verificationProvider.getTransactionReceipt(hash),getSharedConfirmedBlock(provider,verificationProvider)]);
  if(!ta||!tb||!ra||!rb)return {...status(record),message:'Transaction submitted; waiting for inclusion.'};
  if([ta,tb].some(t=>!same(t.hash,hash)||!same(t.from,record.from)||!same(t.to,q.registrar)||!same(t.data,q.calldata)||BigInt(t.value)!==0n||Number(t.chainId)!==registry.chainId)||
    [ra,rb].some(r=>!same(r.hash??r.transactionHash,hash))||ra.blockNumber!==rb.blockNumber||!same(ra.blockHash,rb.blockHash)||ra.status!==rb.status)fail('RPC views disagree on the exact saved transaction');
  if(head.number<ra.blockNumber)return {...status(record),message:'Transaction mined; waiting for its second confirmation.'};
  const blocks=await Promise.all(clients.map(p=>p.getBlock(ra.blockNumber)));
  if(blocks.some(b=>!same(b?.hash,ra.blockHash)))fail('transaction block was reorganized; reconcile before retrying');
  if(ra.status===0)return {...status(record),status:'reverted',message:'The asset transaction reverted. Automatic retries stopped; the saved request and completed assets are retained.'};
  if(ra.status!==1)fail('invalid transaction receipt status');
  if(record.kind==='handle')await registry.verifyHandleClaim({claim:decode(record.claim)});
  else await registry.verifyReceipt({prepared:registry.restorePending(record.serializedIntent),transactionHash:hash});
  const completed=record.kind==='registration'?[...record.completed,{asset:record.assets[record.completed.length],transactionHash:hash}]:record.completed;
  const next={...record,completed,kind:'preparing',request:null,serializedIntent:null,transactionHash:null};await write(record,next);return next;
 }
 async function drive(record){
  for(;;){
   await account(record);
   if(record.kind==='complete')return status(record);
   if(record.kind!=='preparing'){
    const result=await settle(record);if(result.status)return result;record=result;
   }
   const claim=decode(record.claim),fees=feesOf(decode(record.fees));
   if(!await registry.verifyHandleClaim({claim})){
    if(record.action!=='register')fail('the private handle is not registered');
    const request={chainId:registry.chainId,registrar:claim.registry,calldata:claim.calldata,settlementNonce:claim.settlementNonce,maxGasLimit:'4000000'};
    const next={...record,kind:'handle',request};await write(record,next);record=next;
    onProgress?.({phase:'handle',completed:0,total:record.assets.length});await submitted(record);record=await read();continue;
   }
   if(record.completed.length===record.assets.length){const next={...record,kind:'complete'};await write(record,next);return status(next);}
   const asset=record.assets[record.completed.length],current=await registry.partnerAssets({wallet,handle:record.handle});
   if(record.action==='register'&&current.assets.some(a=>same(a,asset))){
    const next={...record,completed:[...record.completed,{asset,transactionHash:null}]};await write(record,next);record=next;continue;
   }
   onProgress?.({phase:'asset',asset,completed:record.completed.length,total:record.assets.length});
   const prepared=record.action==='register'?await registry.prepareRegistration({wallet,claim,feePolicy:fees,asset}):
    record.action==='update'?await registry.prepareFeeUpdate({wallet,handle:record.handle,feePolicy:fees,asset}):await registry.prepareRevocation({wallet,handle:record.handle,asset});
   const next={...record,kind:'registration',request:prepared.request,serializedIntent:registry.serializePending(prepared)};
   await write(record,next);record=next;await submitted(record);record=await read();
  }
 }
 const exclusive=async task=>{if(busy)fail('another asset operation is already running');busy=true;try{return await task();}finally{busy=false;}};
 async function recover({transactionHash,retry=false}={}){
  let record=await read();if(!record)return {status:'none'};await account(record);
  if(['preparing','complete'].includes(record.kind))return drive(record);
  if(record.transactionHash){
   const result=await settle(record);
   if(result.status==='reverted'&&retry){const next={...record,kind:'preparing',request:null,serializedIntent:null,transactionHash:null};await write(record,next);return drive(next);}
   return result.status?result:drive(result);
  }
  const q=record.request;
  async function attach(hash){
   if(!HASH.test(hash)||BigInt(hash)===0n)fail('enter a valid transaction hash');
   const transactions=await Promise.all(clients.map(p=>p.getTransaction(hash)));
   if(transactions.some(t=>!t||!same(t.hash,hash)||!same(t.from,record.from)||!same(t.to,q.registrar)||!same(t.data,q.calldata)||BigInt(t.value)!==0n||Number(t.chainId)!==registry.chainId))fail('transaction differs from the exact saved request');
   const next={...record,transactionHash:hash.toLowerCase()};await write(record,next);record=next;return drive(record);
  }
  if(transactionHash)return attach(transactionHash);
  const claim=decode(record.claim),intent=record.kind==='registration'?registry.restorePending(record.serializedIntent):null;
  const topics=record.kind==='handle'?[id('HandleRegistered(bytes32,bytes32,bytes32,bytes32,uint64)'),claim.handleId]:
   [id('PartnerAssetRegistered(bytes32,uint8,uint64,bytes32)'),claim.handleId,toBeHex(intent.assetIndex,32)];
  const head=await getSharedConfirmedBlock(provider,verificationProvider);
  for(let to=head.number;to>=Math.max(0,head.number-20000);to-=1000){
   const logs=await provider.getLogs({address:q.registrar,topics,fromBlock:Math.max(0,to-999),toBlock:to});
   for(const log of logs){const t=await provider.getTransaction(log.transactionHash);if(same(t?.data,q.calldata)&&same(t?.from,record.from))return attach(log.transactionHash);}
  }
  if(intent&&Number.isSafeInteger(head.timestamp)&&BigInt(head.timestamp)>BigInt(intent.approval.deadline)){
   const next={...record,kind:'preparing',request:null,serializedIntent:null,transactionHash:null};await write(record,next);
   return retry?drive(next):{...status(next),message:'The saved approval expired. Continue to prepare this asset again; completed assets are retained.'};
  }
  await Promise.all(clients.map(p=>p.estimateGas({from:record.from,to:q.registrar,data:q.calldata,value:0n,gasLimit:BigInt(q.maxGasLimit)})));
  if(!retry)return {...status(record),canRetry:true,message:'The exact saved transaction passes simulation. Retry this saved request or recover its hash from your wallet.'};
  const nonces=await Promise.all(clients.flatMap(p=>[p.getTransactionCount(record.from,'latest'),p.getTransactionCount(record.from,'pending')]));
  if(nonces.some(n=>!Number.isSafeInteger(n)||n!==nonces[0]))fail('resolve the pending wallet transaction before retrying');
  await submitted(record,nonces[0]);return drive(await read());
 }
 async function start(action,{handle,fees,assets}){
  const old=await read();if(old&&old.kind!=='complete')fail('resume the saved asset operation first');
  const context=await account(),chosen=choose(assets??supported),selected=feesOf(action==='revoke'?Array.from({length:6},()=>({feeBps:0,minimumFee:0n,maximumFee:0n})):fees);
  const claimed=old?.handle===handle?{claim:decode(old.claim)}:await registry.prepareHandleClaim({wallet,handle});
  const claim=claimed.claim,record={schema:SCHEMA,generationId:registry.generationId,from:context.address.toLowerCase(),
   handle:claim.handle,action,assets:chosen,fees:encode(selected),claim:encode(claim),completed:[],kind:'preparing',request:null,serializedIntent:null,transactionHash:null};
  await write(old,record);return drive(record);
 }
 return Object.freeze({version:2,
  pendingStatus:async()=>status(await read()),
  onboardPartner:input=>exclusive(()=>start('register',input)),
  updatePartnerFees:input=>exclusive(()=>start('update',input)),
  revokePartner:input=>exclusive(()=>start('revoke',input)),
  resumePending:()=>exclusive(async()=>{const r=await read();return r?drive(r):{status:'none'};}),
  recoverPending:input=>exclusive(()=>recover(input)),
 });
}
