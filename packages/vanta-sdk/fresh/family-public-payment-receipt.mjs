import {readFamilyLogWindow} from './family-rpc.mjs';
import {Interface,getAddress,keccak256} from 'ethers';
import {getSharedConfirmedBlock} from './transaction-confirmations.mjs';
const events=new Interface([
 'event CanonicalKzgRow(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment)',
 'event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)',
]);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/iu.test(value);
const address=value=>getAddress(value).toLowerCase();
const fail=()=>{throw Error('Public payment: canonical transaction or recipient outputs differ.');};
/** Verify the exact public payment and all recipient/fee envelopes. The payer
 * never needs the recipient's recovery phrase or note-decryption keys. */
export async function verifyPublicPaymentReceipt({provider,verificationProvider,record,transactionHash,confirmedAnchor,discover=true}){
 const anchor=confirmedAnchor??await getSharedConfirmedBlock(provider,verificationProvider),tx=record.transaction;
 let found=transactionHash||record.transactionHash;
 if(found&&!hash(found))fail();
 if(!found&&discover){
  const from=record.preparedAtBlock;
  if(!Number.isSafeInteger(from)||from<0||from>anchor.number)return {phase:'pending',anchor};
  const matches=logs=>{
   const matched=[];
   for(const log of logs){
    if(log.removed||address(log.address)!==address(tx.to))fail();
    const parsed=events.parseLog(log);
    if(parsed&&parsed.args.commitment===BigInt(record.plan.outputs[0])&&same(parsed.args.encryptedEnvelope,record.plan.encryptedOutputs[0])){
     if(!hash(log.transactionHash))fail();matched.push(log.transactionHash.toLowerCase());
    }
   }
   return matched;
  };
  let chunkBlocks=1000;
  for(let start=from;start<=anchor.number&&!found;){
   const window=await readFamilyLogWindow({fromBlock:start,anchorBlock:anchor.number,chunkBlocks,read:(fromBlock,toBlock)=>{
    const filter={address:tx.to,fromBlock,toBlock,topics:[events.getEvent('CanonicalEncryptedNote').topicHash]};
    return Promise.all([provider.getLogs(filter),verificationProvider.getLogs(filter)]);
   }});
   chunkBlocks=window.chunkBlocks;const [a,b]=window.value;start=window.toBlock+1;
   const first=matches(a),second=matches(b);
   if(first.length>1||JSON.stringify(first)!==JSON.stringify(second))fail();
   found=first[0];
  }
 }
 if(!found)return {phase:'pending',anchor};
 const [a,b,receipt,other]=await Promise.all([provider.getTransaction(found),verificationProvider.getTransaction(found),provider.getTransactionReceipt(found),verificationProvider.getTransactionReceipt(found)]);
 if(!a||!b||!receipt||!other)return {phase:'pending',anchor};
 for(const actual of [a,b])if(!same(actual.hash,found)||address(actual.from)!==address(tx.from)||address(actual.to)!==address(tx.to)||
  BigInt(actual.chainId)!==BigInt(tx.chainId)||BigInt(actual.value)!==BigInt(tx.value)||!same(actual.data,tx.data))fail();
 if(!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber>anchor.number)return {phase:'pending',anchor};
 const normalize=r=>JSON.stringify([r.status,r.blockNumber,String(r.blockHash).toLowerCase(),r.logs.map(log=>[address(log.address),log.topics.map(t=>t.toLowerCase()),log.data.toLowerCase(),log.removed===true])]);
 if(!hash(receipt.blockHash)||normalize(receipt)!==normalize(other))fail();
 const blocks=await Promise.all([provider.getBlock(receipt.blockNumber),verificationProvider.getBlock(receipt.blockNumber)]);
 if(blocks.some(block=>!block||!same(block.hash,receipt.blockHash)))fail();
 if(receipt.status===0)return {phase:'failed',transactionHash:found.toLowerCase(),anchor};
 if(receipt.status!==1)fail();
 const rows=receipt.logs.filter(log=>address(log.address)===address(tx.to)).flatMap(log=>{
  if(log.removed)fail();try{const parsed=events.parseLog(log);return parsed?[parsed]:[];}catch{return [];}
 });
 for(let i=0;i<3;i++){
  const matches=row=>row.args.epoch===BigInt(record.plan.quote.epoch)&&row.args.row===BigInt(record.plan.rowStart+i)&&row.args.commitment===BigInt(record.plan.outputs[i]);
  if(rows.filter(row=>row.name==='CanonicalKzgRow'&&matches(row)).length!==1)fail();
  const encrypted=rows.filter(row=>row.name==='CanonicalEncryptedNote'&&matches(row));
  if(encrypted.length!==1||!same(encrypted[0].args.encryptedEnvelope,record.plan.encryptedOutputs[i])||!same(encrypted[0].args.envelopeHash,keccak256(record.plan.encryptedOutputs[i])))fail();
 }
 return {phase:'finalized',transactionHash:found.toLowerCase(),anchor};
}

/** An unused nonce at the canonical expiry needs no event scan. An occupied
 * nonce requires the exact independently confirmed transaction and outputs. */
export async function reconcileFamilyDepositReceipt({provider,verificationProvider,record,transactionHash,validateAnchor,readUsedNonce}){
 const anchor=await getSharedConfirmedBlock(provider,verificationProvider);
 if(!Number.isSafeInteger(record.deadline)||!Number.isSafeInteger(anchor.timestamp))fail();
 const other=await verificationProvider.getBlock(anchor.number);
 if(other?.timestamp!==anchor.timestamp||!same(other?.hash,anchor.hash))fail();
 await validateAnchor(anchor);
 const finish=async result=>{await validateAnchor(anchor);return result;};
 const known=transactionHash||record.transactionHash;
 if(known){
  const result=await verifyPublicPaymentReceipt({provider,verificationProvider,record,transactionHash:known,confirmedAnchor:anchor,discover:false});
  if(result.phase!=='pending')return finish(result);
 }
 const used=await readUsedNonce(anchor);
 if(typeof used!=='boolean')fail();
 if(!used)return finish({phase:anchor.timestamp>record.deadline?'expired-unused':'pending',anchor});
 const result=await verifyPublicPaymentReceipt({provider,verificationProvider,record:{...record,transactionHash:null},confirmedAnchor:anchor});
 if(result.phase!=='finalized')fail();
 return finish(result);
}
