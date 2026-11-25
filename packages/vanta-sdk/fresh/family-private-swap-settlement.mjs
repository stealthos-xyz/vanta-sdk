/** Private swap orchestration. Source proof once; destination append uses its
 * exact public DEX credit, a private one-time note and the SAME KZG row keys.
 * Journals contain no plaintext outside the encrypted wallet store. */
import {AbiCoder,Interface,TypedDataEncoder,ZeroAddress,hexlify,randomBytes,keccak256} from 'ethers';
import {getCompiledFamilyEvmRelease,verifyCompiledFamilyOperationRuntime} from './family-network.mjs';
import {getCompiledVantaFamilyProofResources} from './family-proof-resources.mjs';
import {createFamilyNoteDelivery} from './family-note-delivery.mjs';
import {depositPoolAbi as poolAbi} from './family-deposit-wire.mjs';
import {requireNativeWalletClearance} from './family-native-clearance.mjs';
import {canonicalFamilyProvider,readFamilyLogRange,readFamilyLogWindow} from './family-rpc.mjs';
import {getConfirmedBlock} from './transaction-confirmations.mjs';
import {privateSwapOutputScope,privateSwapOutputEscrow,privateSwapOutputDomain,privateSwapOutputClaimTypes,
 privateSwapOutputAbi as abi,derivePrivateSwapOutputSigner,verifyPrivateSwapOutput,inspectPrivateSwapOutputClaim} from './family-private-swap-output-wire.mjs';
import {familyRouteHash} from './family-routed-wire.mjs';
const coder=AbiCoder.defaultAbiCoder(),zero='0x'+'00'.repeat(32),safe=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
const row0={a:{x:'0',y:'0'},u:{x:'0',y:'0'},aCompressed:zero,uCompressed:zero,siblings:Array(16).fill(zero)};
const events=new Interface(['event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)']);
const fail=m=>{throw Error('Private swap settlement: '+m);};
export async function createPrivateSwapHost({source,walletController,store,provider,verificationProvider,relayerUrl,artifactBaseUrl,fetcher=fetch,signal,releaseContext}={}){
 const release=getCompiledFamilyEvmRelease(releaseContext),scope=privateSwapOutputScope(release),wallet=walletController.requireWallet(),
  inventory=getCompiledVantaFamilyProofResources(release,releaseContext),routes=inventory.funding.routes,
  output=inventory.funding.pools.find(p=>p.pool===(source.context.pool===routes.nativePool?routes.usdcPool:routes.nativePool));
 if(!output)fail('The destination pool is outside the signed release.');
 const funding=await source.privateOutputRuntime(),r=funding.resources,native=r.profiles.normal8.runtime,domain={schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:r.chainId,familyTag:r.familyTag,
   genesisHash:r.genesisHash,generationId:r.generationId,setupId:release.pins.setupId,pool:output.pool,asset:output.asset,poolCodehash:output.poolCodehash,
   nativeGlueSha256:native.glue.sha256,nativeWasmSha256:native.wasm.sha256},
  delivery=createFamilyNoteDelivery({domain,engine:funding.engine}),namespace='family-private-swap-outputs-v2/'+scope.gateway,pending=new Map();
 const primary=canonicalFamilyProvider(provider),secondary=canonicalFamilyProvider(verificationProvider),pair=fn=>primary===secondary?Promise.resolve(fn(primary)).then(v=>[v,v]):Promise.all([fn(primary),fn(secondary)]);
 const live=()=>{signal?.throwIfAborted();if(walletController.requireWallet()!==wallet)fail('Wallet changed or locked.');};
 const records=async()=>{const rows=await store.read(namespace);if(!Array.isArray(rows)||rows.length>256||rows.some(v=>v.generationId!==scope.generationId||!/^0x[0-9a-f]{64}$/u.test(v.creditId)))fail('Invalid encrypted settlement journal.');return rows;};
 const save=record=>store.transact(namespace,rows=>{const next=rows.filter(r=>r.creditId!==record.creditId);if(next.length>=256)fail('Settlement journal is full.');return {next:[...next,safe(record)],result:safe(record)};});
 const read=async(to,iface,name,args,block)=>{
  const tx={to,data:iface.encodeFunctionData(name,args),blockTag:block.number};const [a,b]=await pair(p=>p.call(tx));
  live();if(a!==b)fail('Canonical contract reads disagree.');return iface.decodeFunctionResult(name,a);
 };
 const anchor=async()=>{const [a,b]=await pair(p=>getConfirmedBlock(p)),n=Math.min(a.number,b.number),[x,y]=await pair(p=>p.getBlock(n));
  if(!x?.hash||x.hash!==y?.hash)fail('A canonical confirmed block is unavailable.');return x;};
 const creditAt=async(id,block)=>{const c=await read(scope.gateway,abi,'credits',[id],block);return{pool:c.pool.toLowerCase(),owner:c.owner.toLowerCase(),salt:c.salt,amount:c.amount.toString(),claimed:c.claimed};};
 const post=async(op,body)=>{const response=await fetcher(new URL('/api/vanta-v8/routed/'+op,relayerUrl),{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(safe(body))});
  const text=await response.text();if(text.length>32768)fail('Relayer response exceeds its limit.');const data=JSON.parse(text);if(!response.ok)fail(typeof data.error==='string'?data.error:'Output submission is unavailable.');return data;};
 async function confirm(record,credit,block){
  let hash=record.transactionHash;
  if(!hash&&credit.claimed){const topic=abi.getEvent('PrivateSwapOutputDeposited').topicHash,
   logs=await readFamilyLogRange(provider,{address:scope.gateway,topics:[topic,null,null,record.creditId],fromBlock:record.sourceBlock??output.deploymentBlock,toBlock:block.number});
   if(logs.length!==1)fail('The canonical output claim is missing or ambiguous.');hash=logs[0].transactionHash;}
  if(!hash)return null;
  const [[tx,tx2],[a,b]]=await Promise.all([pair(p=>p.getTransaction(hash)),pair(p=>p.getTransactionReceipt(hash))]);
  if(!a||!b||a.blockNumber>block.number)return null;
  if(a.blockHash!==b.blockHash||a.status!==b.status||!tx||!tx2||tx.data!==tx2.data||tx.to?.toLowerCase()!==scope.gateway||
   tx2.to?.toLowerCase()!==scope.gateway||tx.chainId!==BigInt(domain.chainId)||tx2.chainId!==BigInt(domain.chainId)||tx.value!==0n||tx2.value!==0n)fail('Output transaction differs.');
  const at=await provider.getBlock(a.blockNumber);if(at?.hash!==a.blockHash)fail('Output transaction is not canonical.');
  if(a.status!==1)return save({...record,phase:'output-retryable',transactionHash:undefined,calldata:undefined});
  const claim=inspectPrivateSwapOutputClaim(scope,tx.data,credit);if(tx.from?.toLowerCase()!==claim.relayer.toLowerCase()||tx2.from?.toLowerCase()!==claim.relayer.toLowerCase()||claim.creditId!==record.creditId||claim.reimbursement!==0n||
   (record.calldata&&tx.data!==record.calldata))fail('The output claim differs from the approved settlement.');
  const q=claim.q,cm=claim.deposit.args[1][0],envelope=claim.deposit.args[2][0];
  const match=receipt=>receipt.logs.filter(l=>l.address.toLowerCase()===credit.pool&&l.topics[0]===events.getEvent('CanonicalEncryptedNote').topicHash);
  const aa=match(a),bb=match(b);if(aa.length!==1||bb.length!==1||aa[0].data!==bb[0].data||JSON.stringify(aa[0].topics)!==JSON.stringify(bb[0].topics))fail('The destination note is missing.');
  const emitted=events.parseLog(aa[0]).args;if(emitted.commitment!==cm||emitted.epoch!==q.epoch||emitted.envelopeHash!==keccak256(envelope)||emitted.encryptedEnvelope!==envelope)fail('The destination note differs.');
  const owned=await delivery.decrypt({wallet,envelope,commitment:'0x'+cm.toString(16).padStart(64,'0')});if(!owned||BigInt(owned.note.amount_units)!==q.gross)fail('The destination note cannot be recovered by this wallet.');
  return save({...record,phase:'finalized',transactionHash:hash,outputAmountAtomic:q.gross.toString(),confirmedBlock:a.blockNumber});
 }
 async function settle(creditId,base,sourceId,sourceBlock){
  if(pending.has(creditId))return pending.get(creditId);
  const task=(async()=>{
   live();let block=await anchor();const credit=await creditAt(creditId,block);
   if(credit.pool!==output.pool||BigInt(credit.amount)<=0n)fail('The source swap has no destination credit.');
   const signer=await derivePrivateSwapOutputSigner(wallet,scope,credit);if(signer.owner!==credit.owner)fail('The output belongs to another private wallet.');
   let record=(await records()).find(r=>r.creditId===creditId)??{creditId,sourceId,sourceBlock,generationId:scope.generationId,pool:output.pool,base,phase:'output-pending'};
   if(record.phase==='finalized')return record;
   const done=await confirm(record,credit,block);if(done?.phase==='finalized')return done;if(done)record=done;
   if(credit.claimed)fail('The destination credit was claimed without a recoverable canonical note.');
   if(record.calldata){const status=await post('output-status',{calldata:record.calldata});
    if(status.transactionHash){record=await save({...record,phase:'output-submitted',transactionHash:status.transactionHash});return record;}
    if(record.deadline>block.timestamp){
     // A crash after saving, before the POST, must resume the identical claim.
     // An accepted journal entry is also resumed through its durable outbox.
     const resumed=await post('output-submit',{calldata:record.calldata});
     if(resumed.transactionHash)return save({...record,phase:'output-submitted',transactionHash:resumed.transactionHash});
     return record;
    }
    // Confirmed unused credit + expired claim: new row keys may be prepared.
    // Server admission releases only provably expired unsigned journal entries.
   }
   await verifyPrivateSwapOutput(provider,scope,output.pool,output.poolCodehash,block.number);
   await verifyCompiledFamilyOperationRuntime(provider,output.pool,releaseContext,['private-swap-gateway','native-screening-clearance']);
   const payer=privateSwapOutputEscrow(scope,credit),verifier=release.lock.contracts.find(p=>p.name==='native-screening-clearance')?.address;
   if(!verifier)fail('Native screening is outside the signed release.');
   const clearance=await requireNativeWalletClearance({release,payer,verifier,timestamp:block.timestamp,serviceUrl:relayerUrl,fetcher,signal,privateSwapCreditId:creditId,
    read:(to,iface,name,args)=>read(to,iface,name,args,block),refreshReadContext:async()=>{
     block=await anchor();return{timestamp:block.timestamp,read:(to,iface,name,args)=>read(to,iface,name,args,block)};
    }}),
    current=await read(output.pool,poolAbi,'currentSource',[],block),policy=(await read(output.pool,poolAbi,'feePolicyHash',[],block))[0],
    note=await delivery.createOwnedNote({wallet,amountAtomic:credit.amount}),recipient=await delivery.walletRecipient(wallet),envelope=await delivery.encrypt({recipient,note}),
    rowKeys=[...(await funding.rowKeys(Number(current.rows),1)),row0,row0,row0,row0],outputs=[note.commitment,0,0,0,0],envelopes=[envelope,'0x','0x','0x','0x'],
    hashes=[keccak256(envelope),zero,zero,zero,zero],deadline=block.timestamp+600,
    q={chainId:domain.chainId,pool:output.pool,asset:output.asset,epoch:current.epoch,checkpoint:current.checkpoint,payer,count:1,gross:credit.amount,
     protocolFeeCap:0,partnerFeeCap:0,protocolRecipient:ZeroAddress,partnerRecipient:ZeroAddress,outputsHash:keccak256(coder.encode(['uint256[5]'],[outputs])),
     envelopesHash:keccak256(coder.encode(['bytes32[5]'],[hashes])),feeSlotsHash:keccak256(coder.encode(['uint8[2]'],[[0,0]])),feeTermsHash:0,partnerRegistryRoot:0,nonce:creditId,deadline,feePolicyHash:policy},
    depositData=poolAbi.encodeFunctionData('depositWithPrivateFeeNotes',[q,outputs,envelopes,rowKeys,[0,0],coder.encode(['uint256'],[note.npk]),clearance.encoded]),
    relayer=(await post('output-relayer',{})).relayer,nonce=BigInt(record.claimNonce??-1)+1n,
    claim={creditId,nonce,deadline,relayer,reimbursement:0,depositHash:keccak256(depositData)},digest=TypedDataEncoder.hash(privateSwapOutputDomain(scope),privateSwapOutputClaimTypes,claim),
    calldata=abi.encodeFunctionData('claim',[creditId,nonce,deadline,relayer,0,depositData,signer.sign(digest)]).toLowerCase();
   inspectPrivateSwapOutputClaim(scope,calldata,credit);
   record=await save({...record,phase:'output-submitting',calldata,claimNonce:nonce.toString(),deadline});
   const sent=await post('output-submit',{calldata});
   if(!/^0x[0-9a-f]{64}$/u.test(sent.transactionHash??''))return record;
   return save({...record,phase:'output-submitted',transactionHash:sent.transactionHash});
  })();pending.set(creditId,task);try{return await task;}finally{pending.delete(creditId);}
 }
 const merge=async base=>{
  const authority=await source.privateOutputAuthority({preparedId:base.preparedId});
  if(!authority.privateOutput)return base;
  const extra={privateOutput:true,outputAsset:output.assetSymbol,outputDecimals:output.assetDecimals};
  if(authority.sourcePhase!=='finalized')return{...base,...extra};
  const result=await settle(familyRouteHash(scope.gateway,authority.route),base,base.preparedId,authority.sourceBlock);
  return{...base,...extra,phase:result.phase==='finalized'?'finalized':'private-output-pending',outputTransactionHash:result.transactionHash??null,
   outputAmountAtomic:result.outputAmountAtomic??authority.outputAmountAtomic};
 };
 // Recover pending outputs from the phrase on a new device. Events expose a
 // one-time salt and claim address, never a wallet root. Scan incrementally;
 // this is note/transaction recovery, not a full contract deployment audit.
 async function recoveredReview(log,event){
  const tx=await provider.getTransaction(log.transactionHash),call=tx&&abi.parseTransaction({data:tx.data});
  if(!call||!['execute8','execute32'].includes(call.name)||tx.to?.toLowerCase()!==scope.gateway||familyRouteHash(scope.gateway,call.args[3])!==event.creditId)fail('Recovered source swap differs.');
  const q=call.args[0],total=q.payout+q.protocolFeeCap+q.partnerFeeCap+q.relayerFeeCap;
  return {preparedId:'swap_'+event.creditId.slice(2),phase:'private-output-pending',operation:4,amountAtomic:q.payout.toString(),
   grossAmountAtomic:total.toString(),totalDebitAtomic:total.toString(),protocolFeeAtomic:q.protocolFeeCap.toString(),partnerFeeAtomic:q.partnerFeeCap.toString(),
   gasReserveAtomic:q.relayerFeeCap.toString(),outputAmountAtomic:event.amount.toString(),transactionHash:log.transactionHash,
   minimumOutputAtomic:call.args[3].minimumOutput.toString(),maximumDeliveryFeeAtomic:'0',publicReceiver:event.escrow.toLowerCase()};
 }
 const orphanView=(record,result)=>({...record.base,privateOutput:true,phase:result.phase==='finalized'?'finalized':'private-output-pending',outputAsset:output.assetSymbol,
  outputDecimals:output.assetDecimals,outputAmountAtomic:result.outputAmountAtomic??record.base.outputAmountAtomic,outputTransactionHash:result.transactionHash??null});
 async function discover(){
  const block=await anchor(),key=namespace+'/cursor/'+output.pool;
  const saved=await store.read(key),cursor=saved[0];let from=cursor?.nextBlock??output.deploymentBlock;
  if(cursor?.blockHash&&(await provider.getBlock(cursor.anchorBlock))?.hash!==cursor.blockHash)from=output.deploymentBlock;
  if(from>block.number)return;
  const topic=abi.getEvent('PrivateSwapOutputReady').topicHash,poolTopic='0x'+output.pool.slice(2).padStart(64,'0');
  const window=await readFamilyLogWindow({fromBlock:from,anchorBlock:block.number,read:(fromBlock,toBlock)=>pair(p=>p.getLogs({address:scope.gateway,topics:[topic,null,poolTopic],fromBlock,toBlock}))});
  const to=window.toBlock,[logs,other]=window.value;
  const canonical=rows=>JSON.stringify(rows.map(l=>[l.blockHash,l.transactionHash,l.index,l.topics,l.data]));
  if(canonical(logs)!==canonical(other))fail('Output recovery events disagree.');
  for(const log of logs){if(log.removed)fail('Output recovery event was removed.');const e=abi.parseLog(log).args,creditId=e.creditId;
   if((await records()).some(r=>r.creditId===creditId))continue;
   const identity={pool:e.pool.toLowerCase(),owner:e.owner.toLowerCase(),salt:e.salt},signer=await derivePrivateSwapOutputSigner(wallet,scope,identity);
   if(signer.owner!==identity.owner||privateSwapOutputEscrow(scope,identity)!==e.escrow.toLowerCase())continue;
   await save({creditId,generationId:scope.generationId,pool:output.pool,sourceBlock:log.blockNumber,phase:'output-pending',
    sourceId:'swap_'+creditId.slice(2),base:await recoveredReview(log,e)});
  }
  const at=await provider.getBlock(to);await store.transact(key,()=>({next:[{nextBlock:to+1,anchorBlock:to,blockHash:at.hash}],result:null}));
 }
 return Object.freeze({...source,
  async quote(input){void Promise.all([source.warmProofRuntime(),funding.rowKeys(32,1)]).catch(()=>{});
   const salt=hexlify(randomBytes(32)),signer=await derivePrivateSwapOutputSigner(wallet,scope,{pool:output.pool,salt}),
   intent={outputPool:output.pool,owner:signer.owner,salt},receiver=privateSwapOutputEscrow(scope,{pool:output.pool,owner:signer.owner,salt});
   return {...await source.quote({...input,receiver,privateOutput:intent}),privateOutput:true,outputAsset:output.assetSymbol};},
  async execute(input){return merge(await source.execute(input));},
  async reconcile(input){if(input.preparedId.startsWith('swap_')){const record=(await records()).find(r=>r.sourceId===input.preparedId&&r.pool===output.pool);if(!record)fail('Recovered swap not found.');return orphanView(record,await settle(record.creditId,record.base,record.sourceId,record.sourceBlock));}return merge(await source.reconcile(input));},
  async list({cached=false}={}){
   // Reading history never submits a return or waits for screening. Explicit
   // reconciliation owns settlement; cached reads use only encrypted journals.
   if(!cached)await discover();
   const list=await source.list(),known=await records(),result=[];
   for(const row of list){const authority=await source.privateOutputAuthority({preparedId:row.preparedId});
    if(!authority.privateOutput){result.push(row);continue;}
    const record=known.find(r=>r.creditId===familyRouteHash(scope.gateway,authority.route));
    result.push({...row,privateOutput:true,outputAsset:output.assetSymbol,outputDecimals:output.assetDecimals,
     phase:authority.sourcePhase==='finalized'?(record?.phase==='finalized'?'finalized':'private-output-pending'):row.phase,
     outputAmountAtomic:record?.outputAmountAtomic??authority.outputAmountAtomic,outputTransactionHash:record?.transactionHash??null});}
   for(const record of known){if(record.pool!==output.pool||list.some(r=>r.preparedId===record.sourceId||r.transactionHash&&r.transactionHash===record.base?.transactionHash))continue;
    result.push(orphanView(record,record));}
   return result;}
,
  async warmProofRuntime(){await Promise.all([source.warmProofRuntime(),funding.rowKeys(32,1)]);},
  dispose(){source.dispose();}
 });
}
