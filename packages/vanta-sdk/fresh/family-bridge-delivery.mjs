import {readFamilyLogWindow} from './family-rpc.mjs';
import {getConfirmedBlock} from './transaction-confirmations.mjs';
/** CCIP delivery evidence is independent of source success. Only the signed
 * destination chain, token, Router and authorized OffRamp are considered. */
import {JsonRpcProvider,Interface,toBeHex,zeroPadValue,keccak256} from 'ethers';
const OFFRAMP=new Interface(['event ExecutionStateChanged(uint64 indexed sourceChainSelector,uint64 indexed sequenceNumber,bytes32 indexed messageId,uint8 state,bytes returnData)']),
 TOKEN=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']),
 ROUTER=new Interface(['function isOffRamp(uint64,address) view returns(bool)']);
const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/u.test(v),fail=()=>{throw Error('CCIP destination evidence is unavailable or differs from the signed route.');};
const sepoliaGenesis='0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9';
const pruned=error=>[error,error?.error,error?.info?.error,error?.cause].some(e=>
 e?.code===4444||/\bRPC 4444\b/u.test(String(e?.message??'')));
export function createFamilyBridgeDeliveryMonitor({routes,signal}){
 const d=routes.destination;
 const open=url=>composeFamilyBridgeDeliveryMonitor({routes,signal,provider:new JsonRpcProvider(url,d.chainId,{cacheTimeout:-1})});
 const primary=open(d.rpcUrl);
 if(d.chainId!==11155111||d.genesisHash!==sepoliaGenesis||d.rpcUrl.replace(/\/$/u,'')!=='https://ethereum-sepolia-rpc.publicnode.com')return primary;
 return withArchiveReads(primary,()=>open('https://sepolia.gateway.tenderly.co'),signal);
}
// Repeat the complete read on one archive endpoint, including chain identity,
// runtime hashes and OffRamp authorization. Never combine partial evidence.
export function withArchiveReads(primary,openArchive,signal){
 let archive;
 async function read(method,args){
  if(archive)return archive[method](...args);
  try{return await primary[method](...args);}catch(error){
   signal?.throwIfAborted();
   if(!pruned(error))throw error;
   archive??=openArchive();
   return archive[method](...args);
  }
 }
 return Object.freeze({anchor:()=>read('anchor',[]),monitor:input=>read('monitor',[input]),dispose(){primary.dispose();archive?.dispose();}});
}
/** Internal provider seam for deterministic finality/reorg tests. */
export function composeFamilyBridgeDeliveryMonitor({routes,signal,provider}){
 const d=routes.destination,live=()=>signal?.throwIfAborted();
 async function anchor(){
  live();const [network,genesis,block]=await Promise.all([provider.getNetwork(),provider.getBlock(0),getConfirmedBlock(provider)]);
  if(Number(network.chainId)!==d.chainId||genesis?.hash!==d.genesisHash||!block?.hash)fail();
  for(const [address,hash]of [[d.token,d.tokenCodehash],[d.router,d.routerCodehash],[d.offRamp,d.offRampCodehash]]){
   if(keccak256(await provider.getCode(address,block.number))!==hash)fail();
  }
  const [allowed]=ROUTER.decodeFunctionResult('isOffRamp',await provider.call({to:d.router,data:ROUTER.encodeFunctionData('isOffRamp',[routes.sourceSelector,d.offRamp]),blockTag:block.number}));
  if(!allowed||(await provider.getBlock(block.number))?.hash!==block.hash)fail();live();return {number:block.number,hash:block.hash};
 }
 return Object.freeze({anchor,async monitor({messageId,receiver,amountAtomic,start,scanBlock,scanAnchor}){
  if(!word(messageId)||BigInt(messageId)===0n||!/^0x[0-9a-f]{40}$/u.test(receiver)||!Number.isSafeInteger(start?.number)||start.number<0||!word(start.hash)||
   !/^[1-9][0-9]{0,36}$/u.test(amountAtomic)||(scanBlock!==undefined&&(!Number.isSafeInteger(scanBlock)||scanBlock<start.number)))fail();
  const head=await anchor();if((await provider.getBlock(start.number))?.hash!==start.hash||head.number<start.number)fail();
  let from=scanBlock??start.number,failed;
  // A persisted height is only useful while its chain anchor remains canonical.
  // Legacy journals have no anchor and must rescan from their immutable start.
  if(scanBlock!==undefined){
   const validAnchor=Number.isSafeInteger(scanAnchor?.number)&&scanAnchor.number>=start.number&&scanAnchor.number<=head.number&&word(scanAnchor.hash);
   if(!validAnchor||(await provider.getBlock(scanAnchor.number))?.hash!==scanAnchor.hash||from>head.number+1)from=start.number;
  }
  let chunkBlocks=1000;
  for(let page=0;from<=head.number&&page<16;page++){
   const window=await readFamilyLogWindow({fromBlock:from,anchorBlock:head.number,chunkBlocks,read:(fromBlock,toBlock)=>provider.getLogs({address:d.offRamp,fromBlock,toBlock,
    topics:[OFFRAMP.getEvent('ExecutionStateChanged').topicHash,toBeHex(BigInt(routes.sourceSelector),32),null,messageId]})});
   const logs=window.value;chunkBlocks=window.chunkBlocks;
   if(logs.length>64)fail();
   for(const log of logs){const event=OFFRAMP.parseLog(log).args,receipt=await provider.getTransactionReceipt(log.transactionHash);
    if(log.removed||log.address.toLowerCase()!==d.offRamp||event.sourceChainSelector!==BigInt(routes.sourceSelector)||event.messageId!==messageId||
     !receipt||receipt.status!==1||receipt.blockNumber!==log.blockNumber||receipt.blockHash!==log.blockHash||receipt.blockNumber>head.number||
     (await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)fail();
    if(event.state===3n){failed={phase:'delivery-failed',messageId,transactionHash:log.transactionHash,blockNumber:receipt.blockNumber};continue;}
    if(event.state!==2n)fail();
    const transfers=receipt.logs.filter(l=>l.address.toLowerCase()===d.token&&l.topics[0]===TOKEN.getEvent('Transfer').topicHash&&l.topics[2]===zeroPadValue(receiver,32))
     .map(l=>TOKEN.parseLog(l).args).filter(t=>t.value===BigInt(amountAtomic));
    if(transfers.length!==1||(await provider.getBlock(head.number))?.hash!==head.hash)fail();live();
    return Object.freeze({phase:'delivered-finalized',messageId,transactionHash:log.transactionHash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,amountAtomic,receiver,scanBlock:from,scanAnchor:{number:head.number,hash:head.hash}});
   }
   from=window.toBlock+1;
  }
  live();return Object.freeze({...failed,phase:failed?'delivery-failed':'awaiting-delivery',messageId,scanBlock:Math.min(from,head.number+1),scanAnchor:{number:head.number,hash:head.hash},finalizedBlock:head.number});
 },dispose(){provider.destroy();}});
}
