/** Customer names use the existing immutable handle registry. Public receiving
 * openings are carried in the claim transaction, authenticated by the exact
 * on-chain record commitment. No partner registration or hosted keys exist. */
import {AbiCoder,Interface,concat,getAddress,getBytes,hexlify,keccak256,toUtf8Bytes,toUtf8String,toBeHex} from 'ethers';
import {getCompiledFamilyEvmRelease,verifyCompiledFamilyOperationRuntime} from './family-network.mjs';
import {getCompiledVantaFamilyProofResources} from './family-proof-resources.mjs';
import {getSharedConfirmedBlock} from './transaction-confirmations.mjs';
import {normalizeVantaFamilyHandle} from './family-handle.mjs';
export {normalizeVantaFamilyHandle} from './family-handle.mjs';
import {vantaPolicyPoseidon} from './partner-policy-kzg.mjs';
const ABI=new Interface(['function getHandleState(bytes32) view returns(tuple(bytes32 recordCommitment,bytes32 ownerCommitment,uint64 epoch,bool exists))','function registerAnonymous(bytes32,bytes32,bytes32,uint256[8],bytes32,uint64)','event HandleRegistered(bytes32 indexed handleId,bytes32 indexed recordCommitment,bytes32 indexed nullifier,bytes32 ownerCommitment,uint64 epoch)']);
const coder=AbiCoder.defaultAbiCoder(),MARKER=keccak256(toUtf8Bytes('STEALTHOS_CUSTOMER_HANDLE_ROUTE_V1')),SCOPE=0x565243563201n,FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const h=n=>toBeHex(n,32).toLowerCase(),same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?h(x):x)),fail=m=>{throw Error('Private handle: '+m);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/u.test(v)&&BigInt(v)>0n;
const field=v=>{if(!word(v)||BigInt(v)>=FR)fail('Invalid receiving field.');return BigInt(v);};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export async function customerHandleId(handle,chainId){return h(await vantaPolicyPoseidon([BigInt(keccak256(toUtf8Bytes(normalizeVantaFamilyHandle(handle)))),BigInt(chainId)]));}
export async function validateCustomerHandleOpening(record,release){
 if(!exact(record,['schema','route','binding'])||record.schema!=='stealthos-customer-handle-v1'||!exact(record.binding,['authorizationCommitment','salt','ownerCommitment','recordCommitment']))fail('Invalid public receiving record.');
 const r=record.route,b=record.binding,registry=release.lock.contracts.find(c=>c.name==='handle-registry'),chainId=Number(release.pins.networkId.split(':')[1]);
 if(!exact(r,['schema','chainId','familyTag','generationId','registry','handle','handleId','receiverCommitment','routingCommitment','collectorMpk','viewingPublicKey','receiverSalt'])||r.schema!=='vanta-family-private-route-v1'||r.chainId!==chainId||r.familyTag!==release.setup.family.tag||r.generationId!==release.pins.generationId||!same(r.registry,registry?.address)||normalizeVantaFamilyHandle(r.handle)!==r.handle||r.handleId!==await customerHandleId(r.handle,chainId))fail('Receiving record belongs to another name or release.');
 const mpk=field(r.collectorMpk),salt=field(r.receiverSalt);field(b.authorizationCommitment);field(b.ownerCommitment);field(b.recordCommitment);
 if(!word(r.viewingPublicKey)||!word(r.routingCommitment)||!word(b.salt))fail('Invalid receiving opening.');
 const commitment=await vantaPolicyPoseidon([mpk,salt,await vantaPolicyPoseidon([BigInt(r.handleId),SCOPE])]);
 if(h(commitment)!==r.receiverCommitment)fail('Receiving key commitment differs.');
 const routing=keccak256(coder.encode(['bytes32','uint256','address','bytes32','uint256','bytes32','bytes32','uint256'],[keccak256(toUtf8Bytes('VANTA_PRIVATE_RECEIVING_ROUTE_V2')),chainId,r.registry,r.handleId,mpk,r.viewingPublicKey,r.receiverSalt,commitment]));
 if(routing!==r.routingCommitment)fail('Receiving route was changed.');
 const recordHash=keccak256(coder.encode(['bytes32','uint256','address','bytes32','uint256','uint256','bytes32','bytes32'],[keccak256(toUtf8Bytes('VANTA_PARTNER_HANDLE_BINDING_V3')),chainId,r.registry,r.handleId,b.authorizationCommitment,commitment,routing,b.salt]));
 if(h(await vantaPolicyPoseidon([BigInt(recordHash),1n,BigInt(chainId)]))!==b.recordCommitment)fail('Receiving record commitment differs.');
 return record;
}
export function customerHandleCalldata(claim,record){
 const decoded=ABI.decodeFunctionData('registerAnonymous',claim.calldata),encoded=ABI.encodeFunctionData('registerAnonymous',[...decoded]);
 if(encoded.toLowerCase()!==claim.calldata.toLowerCase()||!same(decoded[0],record.route.handleId)||!same(decoded[1],record.binding.recordCommitment)||!same(decoded[2],record.binding.ownerCommitment)||decoded[5]!==1n)fail('Claim calldata differs.');
 const bytes=toUtf8Bytes(canonical(record));if(bytes.length>4096)fail('Receiving record is too large.');
 return hexlify(concat([encoded,MARKER,bytes]));
}
export async function parseCustomerHandleCalldata(data,release){
 if(typeof data!=='string'||!/^0x[0-9a-f]+$/iu.test(data)||data.length>10000)fail('Invalid claim transaction.');
 const prefix=data.slice(0,2+420*2),decoded=ABI.decodeFunctionData('registerAnonymous',prefix);
 if(ABI.encodeFunctionData('registerAnonymous',[...decoded]).toLowerCase()!==prefix.toLowerCase()||data.slice(prefix.length,prefix.length+64)!==MARKER.slice(2))fail('Claim transaction has no authenticated receiving record.');
 const record=JSON.parse(toUtf8String(getBytes('0x'+data.slice(prefix.length+64))));
 await validateCustomerHandleOpening(record,release);
 if(!same(decoded[0],record.route.handleId)||!same(decoded[1],record.binding.recordCommitment)||!same(decoded[2],record.binding.ownerCommitment)||decoded[5]!==1n)fail('Claim transaction and receiving record disagree.');
 return record;
}
export async function createFamilyCustomerHandles({walletController,store,provider,verificationProvider,artifactBaseUrl,fetcher=fetch,signal,submitTransaction,reconcileTransaction}){
 const release=getCompiledFamilyEvmRelease(),inventory=getCompiledVantaFamilyProofResources(release),chainId=Number(release.pins.networkId.split(':')[1]),pin=release.lock.contracts.find(c=>c.name==='handle-registry'),pool=inventory.funding.pools[0].pool,namespace='family-customer-handle-v1';
 if(!walletController?.requireWallet||!store?.transact||!pin||typeof submitTransaction!=='function')fail('Trusted wallet and store required.');
 const live=()=>{signal?.throwIfAborted();return walletController.requireWallet();};
 const verify=async()=>{live();await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyOperationRuntime(p,pool,undefined,['handle-registry','handle-adapter','handle-register'])));live();};
 const state=async(handle)=>{const id=await customerHandleId(handle,chainId),block=await getSharedConfirmedBlock(provider,verificationProvider),tx={to:pin.address,data:ABI.encodeFunctionData('getHandleState',[id]),blockTag:block.number},[a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);if(a!==b)fail('Handle reads disagree.');return {id,block,value:ABI.decodeFunctionResult('getHandleState',a)[0]};};
 const rows=async()=>{const list=await store.read(namespace);if(!Array.isArray(list)||list.length>1)fail('Invalid saved claim.');for(const row of list){if(!['prepared','submitting','submitted','confirmed'].includes(row?.phase)||row.transactionHash!==null&&!/^0x[0-9a-f]{64}$/u.test(row.transactionHash??''))fail('Invalid saved claim state.');await validateCustomerHandleOpening(row.record,release);if(row.phase!=='confirmed'&&canonical(await parseCustomerHandleCalldata(row.data,release))!==canonical(row.record))fail('Saved claim calldata differs.');}return list;};
 const save=async(next,expected)=>store.transact(namespace,current=>{if(canonical(current)!==canonical(expected))fail('Claim changed in another tab.');return {next,result:next[0]};});
 const view=row=>row?Object.freeze({handle:row.record.route.handle,phase:row.phase,transactionHash:row.transactionHash??null}):null;
 const request=row=>({chainId,to:pin.address,data:row.data,value:'0',transactionDigest:keccak256(row.data),handle:row.record.route.handle});
 // Names supplied by an app are discovery hints, never ownership evidence.
 // Recreate both the receiving route AND owner/record commitments locally.
 let recoveryHints=[],discovery;
 const ownRecord=async handle=>{
  const wallet=live();
  const [route,binding]=await Promise.all([wallet.exportFamilyPartnerReceivingRoute({handle}),wallet.exportFamilyHandleBinding({handle})]);
  live();const record=copy({schema:'stealthos-customer-handle-v1',route,binding});
  await validateCustomerHandleOpening(record,release);return record;
 };
 const recoverNamed=async handle=>{
  const [record,s]=await Promise.all([ownRecord(handle),state(handle)]);
  if(!s.value.exists||s.value.epoch!==1n||!same(s.value.ownerCommitment,record.binding.ownerCommitment)||!same(s.value.recordCommitment,record.binding.recordCommitment))return null;
  const anchors=await Promise.all([provider,verificationProvider].map(p=>p.getBlock(s.block.number)));
  if(anchors.some(b=>!same(b?.hash,s.block.hash)))fail('Handle recovery anchor changed.');
  live();return record;
 };
 const recover=async()=>{
  if(discovery)return discovery;
  const task=(async()=>{
   const saved=await rows();
   if(saved[0]){
    const own=await ownRecord(saved[0].record.route.handle);
    if(canonical(own)!==canonical(saved[0].record))fail('Saved handle belongs to another private wallet.');
    return view(saved[0]);
   }
   await verify();
   const names=[...new Set(['protocol.stealth','relayer.stealth',...recoveryHints])];
   const matches=(await Promise.all(names.map(recoverNamed))).filter(Boolean);
   if(matches.length>1)fail('More than one existing handle belongs to this wallet; no new claim is allowed.');
   if(!matches[0])return null;
   const latest=await rows();
   if(latest[0])return view(latest[0]);
   await save([{record:matches[0],phase:'confirmed',transactionHash:null}],latest);
   return view((await rows())[0]);
  })();discovery=task;
  try{return await task;}finally{if(discovery===task)discovery=undefined;}
 };
 const confirmedRecord=async handle=>{
  await verify();const s=await state(handle);if(!s.value.exists)return null;
  const topic=ABI.getEvent('HandleRegistered').topicHash,from=Math.max(0,Math.min(...inventory.funding.pools.map(p=>p.deploymentBlock))-1024);
  for(let end=s.block.number;end>=from;end-=10000){const start=Math.max(from,end-9999),logs=await provider.getLogs({address:pin.address,fromBlock:start,toBlock:end,topics:[topic,s.id]});
   for(const log of logs){if(log.removed)continue;const [a,b,atA,atB]=await Promise.all([provider.getTransaction(log.transactionHash),verificationProvider.getTransaction(log.transactionHash),provider.getBlock(log.blockNumber),verificationProvider.getBlock(log.blockNumber)]);
    if(!a||!b||a.data!==b.data||a.hash!==b.hash||!same(a.to,pin.address)||a.value!==0n||a.chainId!==BigInt(chainId)||!same(atA?.hash,log.blockHash)||!same(atB?.hash,log.blockHash))fail('Claim transaction is not canonical.');
    const record=await parseCustomerHandleCalldata(a.data,release);if(record.route.handle!==handle||!same(s.value.ownerCommitment,record.binding.ownerCommitment)||!same(s.value.recordCommitment,record.binding.recordCommitment)||s.value.epoch!==1n)fail('Confirmed claim differs from its receiving opening.');const stable=await Promise.all([provider.getBlock(s.block.number),verificationProvider.getBlock(s.block.number)]);if(stable.some(b=>!same(b?.hash,s.block.hash)))fail('Claim confirmation anchor changed.');return record;
   }
  }fail('This name has no customer receiving record in this SDK generation.');
 };
 return Object.freeze({
  async available(handle){await verify();const s=await state(normalizeVantaFamilyHandle(handle));return {available:!s.value.exists,handle:normalizeVantaFamilyHandle(handle)};},
  async current(hints=[]){live();if(!Array.isArray(hints)||hints.length>16)fail('Invalid handle recovery hints.');recoveryHints=hints.map(normalizeVantaFamilyHandle);return recover();},
  async claim(handle){const wallet=live(),name=normalizeVantaFamilyHandle(handle);await recover();await verify();let list=await rows();
   if(list[0]&&list[0].record.route.handle!==name)fail('This wallet already has a saved handle claim.');
   const existing=await state(name);
   if(existing.value.exists){const record=await confirmedRecord(name),own=await wallet.exportFamilyPartnerReceivingRoute({handle:name});if(canonical(record.route)!==canonical(own))fail('This handle belongs to another private wallet.');await save([{record,phase:'confirmed',transactionHash:list[0]?.transactionHash??null}],list);return view((await rows())[0]);}
   if(list[0]&&list[0].phase!=='prepared')fail('A claim may already have been submitted. Check its status before retrying.');
   if(!list[0]){const claim=await wallet.prepareFamilyPartnerHandleClaim({handle:name,artifactBaseUrl,fetcher,signal}),route=await wallet.exportFamilyPartnerReceivingRoute({handle:name}),record=copy({schema:'stealthos-customer-handle-v1',route,binding:{authorizationCommitment:claim.authorizationCommitment,salt:claim.salt,ownerCommitment:claim.ownerCommitment,recordCommitment:claim.recordCommitment}});await validateCustomerHandleOpening(record,release);const data=customerHandleCalldata(claim,record);await save([{record,data,phase:'prepared',transactionHash:null}],list);list=await rows();}
   const row=list[0];await Promise.all([provider,verificationProvider].map(p=>p.call({to:pin.address,data:row.data,value:0n,blockTag:'latest'})));live();
   await save([{...row,phase:'submitting'}],list);const submitted=await rows();
   try{const hash=await submitTransaction(request(row));if(!/^0x[0-9a-f]{64}$/iu.test(hash))fail('Relayer returned an invalid transaction hash.');await save([{...row,phase:'submitted',transactionHash:hash.toLowerCase()}],submitted);return view((await rows())[0]);}
   catch(error){if(error?.code==='USER_REJECTED')await save([{...row,phase:'prepared'}],submitted);throw error;}
  },
  async check(){let list=await rows();if(!list[0])return null;
   if(list[0].phase==='submitting'&&!list[0].transactionHash&&reconcileTransaction){const row=list[0],hash=await reconcileTransaction(request(row));live();
    if(hash!==null&&!/^0x[0-9a-f]{64}$/iu.test(hash))fail('Relayer returned an invalid transaction hash.');
    await save([{...row,phase:hash?'submitted':'prepared',transactionHash:hash?.toLowerCase()??null}],list);list=await rows();}
   const record=await confirmedRecord(list[0].record.route.handle);if(!record)return view(list[0]);if(canonical(record)!==canonical(list[0].record))fail('Saved receiving record differs.');await save([{...list[0],phase:'confirmed'}],list);return view((await rows())[0]);},
  async find(handle){const name=normalizeVantaFamilyHandle(handle);await verify();const record=await recoverNamed(name);if(!record)fail('This handle is not registered to this private wallet.');const list=await rows();if(list[0]&&list[0].record.route.handle!==name)fail('Another claim is saved.');await save([{record,phase:'confirmed',transactionHash:null}],list);return view((await rows())[0]);},
  async resolve(handle,asset){const record=await confirmedRecord(normalizeVantaFamilyHandle(handle));if(!record)fail('Handle is not registered.');const d=inventory.funding.pools.find(p=>asset==='native'?BigInt(p.asset)===0n:same(p.asset,asset));if(!d)fail('Asset is outside this release.');return Object.freeze({schema:'vanta-family-note-recipient-v1',familyTag:release.setup.family.tag,chainId,genesisHash:release.pins.genesisHash,generationId:release.pins.generationId,setupId:release.pins.setupId,pool:d.pool,asset:d.asset,masterPublicKey:record.route.collectorMpk,viewingPublicKey:record.route.viewingPublicKey});}
 });
}
