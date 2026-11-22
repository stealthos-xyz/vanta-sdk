import {getConfirmedBlock} from './transaction-confirmations.mjs';
/** Browser-worker recovery against the selected compiled KZG generation.
 * No relayer, partner host, fee signature or mutable update service is used. */
import {ZeroAddress,hexlify,randomBytes,keccak256} from 'ethers';
import {gcm} from '@noble/ciphers/aes';
import {getBytes,toUtf8Bytes} from 'ethers';
import {getCompiledFamilyEvmRelease,verifyCompiledFamilyRecoveryRuntime} from './family-network.mjs';
import {createVantaEnhancedFundingRuntime} from './family-enhanced-funding-runtime.mjs';
import {createFamilyNoteDelivery} from './family-note-delivery.mjs';
import {recoverFamilyCanonicalNotes} from './family-note-recovery.mjs';
import {createFamilySpendFence} from './family-spend-fence.mjs';
import {familyExitAbi as ABI,familyExitBatchField,familyExitDigest,encodeFamilyExit} from './family-exit-wire.mjs';
import {enhancedAddress as address,enhancedField as field,enhancedRandomField as random,ENHANCED_FIELD as FR,
 enhancedHashNullifiers,enhancedHashOutputs} from './family-enhanced-wire.mjs';
const fail=message=>{throw Error('Private recovery exit: '+message);},same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/u.test(v),
 terminal=v=>v.phase==='finalized'||v.phase==='expired-unused'||v.phase==='failed'&&v.settled===true;
const due=(gross,bps,min)=>{const fee=(gross*BigInt(bps)+9999n)/10000n;return fee>BigInt(min)?fee:BigInt(min);};
let dummies;
async function dummyPrefix(){dummies??=import('#vanta-circom-crypto').then(m=>m.buildPoseidon());const h=await dummies;
 return Array.from({length:32},(_,i)=>field(h.F.toObject(h([0x564c4b5044554d59n,BigInt(i+1)]))));}
export async function createVantaFamilyExitHost({walletController,store,provider,verificationProvider,asset='native',
 artifactBaseUrl,fetcher,releaseContext,signal,onProgress,approveExit,submitTransaction}={}){
 if(!provider||!verificationProvider||provider===verificationProvider||!store||typeof walletController?.requireWallet!=='function'||
  typeof approveExit!=='function'||typeof submitTransaction!=='function')fail('Trusted wallet, encrypted store and wallet approval are required.');
 signal?.throwIfAborted();
 const release=getCompiledFamilyEvmRelease(releaseContext),wallet=walletController.requireWallet();
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 let funding;
 try{
 controller.signal.throwIfAborted();
 funding=await createVantaEnhancedFundingRuntime({asset,releaseContext,artifactBaseUrl,fetcher,signal:controller.signal,onProgress});
 const r=funding.resources,d=r.deployment,native=r.profiles.normal8.runtime,
  domain=Object.freeze({schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:r.chainId,familyTag:r.familyTag,
   genesisHash:r.genesisHash,generationId:r.generationId,setupId:d.setupId,pool:d.pool,asset:d.asset,poolCodehash:d.poolCodehash,
   nativeGlueSha256:native.glue.sha256,nativeWasmSha256:native.wasm.sha256});
 if(!store.scope?.endsWith('/'+release.pins.networkId+'/'+release.pins.generationId))fail('Wallet journal belongs to another generation.');
 const delivery=createFamilyNoteDelivery({domain,engine:await funding.noteEngine()}),namespace='family-recovery-exits-v1/'+d.pool,
  fences=createFamilySpendFence({store,pool:d.pool});let busy=false,closed=false;
 const live=()=>{controller.signal.throwIfAborted();if(closed||walletController.requireWallet()!==wallet)fail('Wallet changed or locked.');};
 live();
 const rows=items=>{if(!Array.isArray(items)||items.length>256||new Set(items.map(v=>v?.id)).size!==items.length)fail('Invalid encrypted exit journal.');
  for(const v of items){if(!v||v.schema!=='stealthos-family-recovery-exit-v1'||v.networkId!==release.pins.networkId||v.generationId!==r.generationId||
   v.pool!==d.pool||!['proving','prepared','submitting','included','finalized','failed','expired-unused'].includes(v.phase)||
   !/^exit_[0-9a-f]{64}$/u.test(v.id??'')||!Array.isArray(v.nullifiers)||v.nullifiers.length<1||v.nullifiers.length>32||
   v.nullifiers.some(n=>!word(n)||BigInt(n)===0n||BigInt(n)>=FR)||new Set(v.nullifiers).size!==v.nullifiers.length||
   !Number.isSafeInteger(v.anchorBlock)||v.anchorBlock<d.deploymentBlock||
   typeof v.gross!=='string'||!/^\d{1,37}$/u.test(v.gross)||BigInt(v.gross)>=(1n<<120n)||
   !v.q||v.q.pool!==d.pool||v.q.asset!==d.asset||v.q.chainId!==r.chainId||
   !word(v.q.nonce)||v.id!=='exit_'+v.q.nonce.slice(2)||![8,32].includes(v.q.width)||v.nullifiers.length>v.q.width||
   !Number.isSafeInteger(v.q.sourceEpoch)||v.q.sourceEpoch<0||!Number.isSafeInteger(v.q.deadline)||v.q.deadline<1||
   v.transactionHash!=null&&!word(v.transactionHash)||v.submittedHash!=null&&!word(v.submittedHash)||
   v.scanBlock!==undefined&&(!Number.isSafeInteger(v.scanBlock)||v.scanBlock<v.anchorBlock)||
   v.scanAnchor!==undefined&&(!Number.isSafeInteger(v.scanAnchor.number)||!word(v.scanAnchor.hash)))fail('Invalid encrypted exit binding.');
   try{
    if(address(v.q.recipient)===ZeroAddress||v.q.recipient===d.pool||v.q.relayer!==ZeroAddress||
     BigInt(v.gross)!==BigInt(v.q.payout)+BigInt(v.q.protocolFee)+BigInt(v.q.partnerFee)||BigInt(v.q.payout)<=0n||
     BigInt(v.q.protocolFee)<0n||BigInt(v.q.partnerFee)<0n||BigInt(v.q.protocolFeeCap)!==BigInt(v.q.protocolFee)||
     BigInt(v.q.partnerFeeCap)!==BigInt(v.q.partnerFee))fail('Invalid encrypted exit amounts.');
    familyExitDigest(v.q);
    if(v.calldata!=null){
     if(typeof v.calldata!=='string'||v.calldata.length>2*1024*1024||!/^0x(?:[0-9a-f]{2})+$/u.test(v.calldata)||keccak256(v.calldata)!==v.calldataHash)fail('Invalid saved exit calldata.');
     const tx=ABI.parseTransaction({data:v.calldata});
     if(tx?.name!=='settleNoAppendExit'+v.q.width||tx.args[2]!=='0x'||familyExitDigest(tx.args[0])!==familyExitDigest(v.q)||
      v.nullifiers.some((n,i)=>BigInt(n)!==tx.args[1].action.nullifiers[i]))fail('Invalid saved exit quote.');
    }else if(v.calldataHash!=null||['prepared','submitting','included','finalized','expired-unused'].includes(v.phase))fail('Missing saved exit calldata.');
   }catch{fail('Invalid encrypted exit transaction.');}
  }return items;};
 const backupDomain=Object.freeze({schema:'stealthos-family-exit-recovery-v1',networkId:release.pins.networkId,generationId:r.generationId,pool:d.pool}),
  backupAad=toUtf8Bytes(JSON.stringify(backupDomain));
 const backupKey=async()=>{live();const keys=await wallet.privateWalletKeys();live();const material=new Uint8Array([
  ...toUtf8Bytes('STEALTHOS_FAMILY_EXIT_BACKUP_V1'),...keys.viewingPrivateKey,...backupAad]);
  try{return getBytes(keccak256(material));}finally{material.fill(0);}};
 const update=fn=>{live();return store.transact(namespace,v=>{live();const change=fn(rows(v));rows(change.next);return change;});},
  read=async id=>{live();const items=await store.read(namespace);live();const row=rows(items).find(v=>v.id===id);if(!row)fail('Unknown recovery exit.');return row;},
  set=(id,fn)=>update(items=>{const old=items.find(v=>v.id===id);if(!old)fail('Unknown recovery exit.');const next=fn(old);
   return {next:items.map(v=>v===old?next:v),result:next};});
 const both=async(to,name,args=[],blockTag='latest')=>{
  const tx={to,data:ABI.encodeFunctionData(name,args),blockTag},[a,b]=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);
  live();if(!same(a,b))fail('Canonical contract reads disagree.');return ABI.decodeFunctionResult(name,a);
 };
 const anchor=async()=>{const [a,b]=await Promise.all([getConfirmedBlock(provider),getConfirmedBlock(verificationProvider)]);
  live();
  const height=Math.min(a?.number,b?.number);if(!Number.isSafeInteger(height)||height<d.deploymentBlock)fail('Confirmed state is unavailable.');
  const [x,y]=await Promise.all([provider.getBlock(height),verificationProvider.getBlock(height)]);
  if(!x?.hash||!same(x.hash,y?.hash)||x.number!==height||y.number!==height||
   !Number.isSafeInteger(x.timestamp)||x.timestamp<0||x.timestamp!==y.timestamp)fail('Canonical anchor differs.');return x;};
 const stable=async block=>{const [a,b]=await Promise.all([provider.getBlock(block.number),verificationProvider.getBlock(block.number)]);
  live();if(!same(a?.hash,block.hash)||!same(b?.hash,block.hash))fail('Canonical anchor changed.');};
 const review=row=>Object.freeze({preparedId:row.id,networkId:row.networkId,generationId:row.generationId,pool:d.pool,
  recipient:row.q.recipient,asset:d.assetSymbol,assetDecimals:d.assetDecimals,totalDebitAtomic:row.gross,
  payoutAtomic:row.q.payout,protocolFeeAtomic:row.q.protocolFee,partnerFeeAtomic:row.q.partnerFee,expiresAt:row.q.deadline,
  sourceEpoch:row.q.sourceEpoch,selectedNoteCount:row.nullifiers.length});
 const simulate=async row=>{
  if(!row.calldata||keccak256(row.calldata)!==row.calldataHash)fail('Saved exit calldata differs.');
  await Promise.all([provider,verificationProvider].map(p=>verifyCompiledFamilyRecoveryRuntime(p,d.pool,releaseContext)));
  const decoded=ABI.parseTransaction({data:row.calldata});
  if(!decoded||decoded.name!=='settleNoAppendExit'+row.q.width||decoded.args[2]!=='0x'||familyExitDigest(decoded.args[0])!==familyExitDigest(row.q))fail('Saved exit quote differs.');
  const [a,b]=await Promise.all([provider.getBlock('latest'),verificationProvider.getBlock('latest')]);
  if(!a?.hash||!b?.hash||Math.max(a.timestamp,b.timestamp)+30>=row.q.deadline)fail('Exit review expired; reconcile it before preparing another.');
  const tx={to:d.pool,data:row.calldata,value:0n,blockTag:'pending'};
  const result=await Promise.all([provider.call(tx),verificationProvider.call(tx)]);live();if(!same(result[0],result[1]))fail('Exit simulation differs.');
 };
 async function reconcile(id){
  let row=await read(id);
  const status=v=>Object.freeze({preparedId:id,phase:v.phase,transactionHash:v.transactionHash??v.submittedHash??null});
  if(terminal(row)){await fences.finish(id);return status(row);}
  if(row.phase==='failed'||row.phase==='proving'&&!row.calldata)return status(row);
  if(!row.transactionHash&&row.submittedHash){await recordHash(id,row.submittedHash);row=await read(id);}
  const block=await anchor();
  // The wallet may replace a pending gas transaction. A saved old hash must
  // not hide the canonical exit under its replacement hash.
  if(row.q&&(await both(d.pool,'usedNonce',[row.q.nonce],block.number))[0]===true){
   const topic=ABI.getEvent('PreAuditFullExit').topicHash;
   let start=row.anchorBlock;
   if(row.scanAnchor){const views=await Promise.all([provider.getBlock(row.scanAnchor.number),verificationProvider.getBlock(row.scanAnchor.number)]);
    if(views.every(v=>same(v?.hash,row.scanAnchor.hash)))start=row.scanBlock??start;}
   let pages=0;
   for(let from=start;from<=block.number&&pages++<128;from+=1024){
    const filter={address:d.pool,fromBlock:from,toBlock:Math.min(from+1023,block.number),topics:[topic]},
     [a,b]=await Promise.all([provider.getLogs(filter),verificationProvider.getLogs(filter)]);
    const normalize=logs=>JSON.stringify(logs.map(l=>[l.address,l.blockNumber,l.blockHash,l.transactionHash,l.topics,l.data,l.removed===true]));
    live();if(a.length>16384||b.length>16384||normalize(a)!==normalize(b))fail('Canonical exit events disagree.');
    const matches=a.filter(l=>{try{return !l.removed&&same(l.address,d.pool)&&same(ABI.parseLog(l)?.args.quoteNonce,row.q.nonce);}catch{return false;}});
    if(matches.length>1)fail('Duplicate canonical exit nonce.');
    if(matches.length){await recordHash(id,matches[0].transactionHash);row=await read(id);break;}
    await stable(block);await set(id,v=>({...v,scanBlock:filter.toBlock+1,scanAnchor:{number:block.number,hash:block.hash}}));
   }
  }
  if(row.transactionHash&&await recordHash(id,row.transactionHash)){
   const [a,b]=await Promise.all([provider.getTransactionReceipt(row.transactionHash),verificationProvider.getTransactionReceipt(row.transactionHash)]);
   if(a&&b&&same(a.hash,row.transactionHash)&&same(b.hash,row.transactionHash)&&same(a.blockHash,b.blockHash)&&a.blockNumber===b.blockNumber&&a.status===b.status){
    const canonical=await Promise.all([provider.getBlock(a.blockNumber),verificationProvider.getBlock(a.blockNumber)]);
    if(canonical.some(v=>!same(v?.hash,a.blockHash)))fail('Exit receipt is not canonical.');
    if(a.blockNumber<=block.number){
     if(a.status===1){
      for(const receipt of [a,b]){
       const logs=receipt.logs.map(l=>{if(!same(l.address,d.pool)||l.removed)return null;try{return ABI.parseLog(l);}catch{return null;}})
        .filter(l=>l?.name==='PreAuditFullExit'&&same(l.args.quoteNonce,row.q.nonce)&&same(l.args.recipient,row.q.recipient)&&
         l.args.payout===BigInt(row.q.payout)&&l.args.protocolFee===BigInt(row.q.protocolFee)&&l.args.partnerFee===BigInt(row.q.partnerFee)&&
         l.args.sourceEpoch===BigInt(row.q.sourceEpoch)&&l.args.width===BigInt(row.q.width)&&l.args.sourceCheckpoint===BigInt(row.q.sourceCheckpoint));
       if(logs.length!==1)fail('Finalized receipt does not contain the exact exit.');
      }
      for(const n of row.nullifiers)if((await both(d.pool,'nullifierSpent',[n],block.number))[0]!==true)fail('Exit nullifiers are not finalized.');
      await stable(block);await set(id,v=>({...v,phase:'finalized'}));await fences.finish(id);
     }else if(a.status===0){await stable(block);await set(id,v=>({...v,phase:'failed',settled:true}));await fences.finish(id);}
    }else await set(id,v=>({...v,phase:'included'}));
   }else if(row.phase==='included')await set(id,v=>terminal(v)?v:{...v,phase:'submitting'});
  }
  row=await read(id);
  if(!terminal(row)&&block.timestamp>row.q?.deadline&&row.phase!=='proving'){
   const used=(await both(d.pool,'usedNonce',[row.q.nonce],block.number))[0];
   const spent=await Promise.all(row.nullifiers.map(async n=>(await both(d.pool,'nullifierSpent',[n],block.number))[0]));
   if(!used&&spent.every(v=>v===false)){await stable(block);await set(id,v=>({...v,phase:'expired-unused'}));await fences.finish(id);}
  }
  return status(await read(id));
 }
 return Object.freeze({context:Object.freeze({networkId:release.pins.networkId,generationId:r.generationId,pool:d.pool,asset:d.asset}),
  async recoverNotes(){
   live();const inventory=await recoverFamilyCanonicalNotes({provider,verificationProvider,delivery,wallet,deploymentBlock:d.deploymentBlock});
   if(!inventory.complete)fail('Canonical note recovery is incomplete.');
   return Object.freeze({networkId:release.pins.networkId,generationId:r.generationId,pool:d.pool,asset:d.assetSymbol,
    assetDecimals:d.assetDecimals,balanceAtomic:inventory.verifiedSpendableAtomic,blockNumber:inventory.blockNumber,blockHash:inventory.blockHash,
    sources:Object.freeze(inventory.epochs.map(e=>{const notes=inventory.notes.filter(n=>n.epoch===e.epoch&&n.status==='spendable');
     return Object.freeze({epoch:e.epoch,count:notes.length,balanceAtomic:notes.reduce((v,n)=>v+BigInt(n.opening.amount_units),0n).toString()});}).filter(v=>v.count))});
  },
  async prepare({recipient,sourceEpoch}={}){
   live();if(busy)fail('Another exit is in progress.');busy=true;let id,saved=false,reserved=false;
   try{
    recipient=address(recipient);if(recipient===ZeroAddress||recipient===d.pool)fail('Choose your public receiving address.');
    const inventory=await recoverFamilyCanonicalNotes({provider,verificationProvider,delivery,wallet,deploymentBlock:d.deploymentBlock});
    if(!inventory.complete)fail('Canonical note recovery is incomplete.');
    const blocked=await fences.blocked();
    // Also respect pending entries created by the preceding SDK version.
    for(const row of await store.read('enhanced-funding-preparations-v1/'+d.pool))
     if(row.phase!=='failed')for(const n of row.nullifiers??[])blocked.add(n);
    const source=inventory.epochs.find(e=>(sourceEpoch===undefined||sourceEpoch===e.epoch)&&inventory.notes.some(n=>n.epoch===e.epoch&&n.status==='spendable'&&!blocked.has(n.nullifier)));
    if(!source)fail('No unlocked notes are available in that source epoch.');
    const selected=inventory.notes.filter(n=>n.epoch===source.epoch&&n.status==='spendable'&&!blocked.has(n.nullifier)).slice(0,32),width=selected.length<=8?8:32;
    const block=await anchor(),snapshot=await both(d.pool,'sourceSnapshot',[source.epoch],block.number);
    if(Number(snapshot.rows)!==source.rows||BigInt(snapshot.checkpoint)!==BigInt(source.checkpoint)||BigInt(snapshot.x)!==BigInt(source.x)||BigInt(snapshot.y)!==BigInt(source.y))fail('Source checkpoint changed. Refresh recovery.');
    const values={};for(const name of ['exitProtocolFeeBps','exitPartnerFeeBps','minimumProtocolFee','fixedPartnerExitFee','protocolFeeRecipient','partnerFeeRecipient'])values[name]=(await both(d.pool,name,[],block.number))[0];
    const versioned=release.lock.contracts.some(v=>v.name==='protocol-fee-policy');
    const feePolicyHash=(await both(d.pool,versioned?'exitFeePolicyHash':'feePolicyHash',[],block.number))[0];
    const gross=selected.reduce((sum,n)=>sum+BigInt(n.opening.amount_units),0n),protocol=due(gross,values.exitProtocolFeeBps,values.minimumProtocolFee),partner=due(gross,values.exitPartnerFeeBps,values.fixedPartnerExitFee);
    if(gross>((1n<<120n)-1n))fail('Select a source with a total below the supported exit amount.');
    if(gross<=protocol+partner)fail('These notes do not cover their immutable exit fees.');
    const payout=gross-protocol-partner,nonce=hexlify(randomBytes(32)),head=await provider.getBlock('latest');
    if(!head||!Number.isSafeInteger(head.timestamp))fail('Chain clock unavailable.');
    const q={chainId:r.chainId,pool:d.pool,asset:d.asset,width,sourceEpoch:source.epoch,sourceCheckpoint:source.checkpoint,recipient,
     payout:payout.toString(),protocolFee:protocol.toString(),partnerFee:partner.toString(),protocolFeeCap:protocol.toString(),partnerFeeCap:partner.toString(),
     protocolRecipient:address(values.protocolFeeRecipient),partnerRecipient:address(values.partnerFeeRecipient),relayer:ZeroAddress,
     nullifiersHash:'0x'+'00'.repeat(32),outputsHash:'0x'+'00'.repeat(32),saltedAmountHash:field(1),nonce,deadline:head.timestamp+3600,feePolicyHash};
    id='exit_'+nonce.slice(2);
    await update(items=>{if(items.length>=256)fail('Exit journal is full. Preserve its backup before continuing.');return {next:[...items,{schema:'stealthos-family-recovery-exit-v1',id,networkId:release.pins.networkId,generationId:r.generationId,pool:d.pool,
     phase:'proving',nullifiers:selected.map(n=>n.nullifier),q,gross:gross.toString(),anchorBlock:block.number,calldata:null,calldataHash:null,transactionHash:null}],result:undefined};});
    saved=true;
    await fences.reserve({id,nullifiers:selected.map(n=>n.nullifier)});reserved=true;
    if((await read(id)).phase!=='proving')fail('Exit preparation was cancelled.');
    const batch=familyExitBatchField(q),amountSalt=random(),padSeed=random();q.saltedAmountHash=await funding.amountCommitment({amountAtomic:q.payout,amountSalt,digest:batch});
    const keys=await wallet.privateWalletKeys();
    const witness={schema:'vanta-wallet-witness-v1',checkpoint_ref:source.checkpoint,
     inputs:selected.map(({opening:n})=>({npk:n.npk,token_hash:n.token_hash,value:field(n.amount_units),random:n.random,
      nullifying_key:field(keys.nullifyingKey),pub_key_x:field(keys.spendingPublicKey[0]),pub_key_y:field(keys.spendingPublicKey[1])})),
     // A full exit has no logical output notes. The unchanged circuit creates
     // its five canonical padding commitments from pad_seed itself. Supplying
     // five active zero-value notes is invalid when public exit fees are due.
     outputs:[],withdraw_amount:field(q.payout),action_token_hash:selected[0].opening.token_hash,
     spend_secret_scalar:field(keys.spendSecretScalar),pad_seed:padSeed,
     action:{chain_id:field(r.chainId),pool:field(d.pool),action_type:field(6),source_table:field(source.epoch,true),target_table:field(0,true),
      token_address:field(d.asset,true),recipient:field(recipient),protocol_fee:field(protocol,true),protocol_fee_recipient:field(q.protocolRecipient),
      partner_fee:field(partner,true),partner_fee_recipient:field(q.partnerRecipient,true),aux_data_hash:field(0,true)}};
    const binding={public_amount_hash:q.saltedAmountHash,private_amount_salt:amountSalt,batch_digest_field:batch,fee_quote_digest_field:field(1),
     protocol_fee_cap:field(protocol,true),partner_fee_cap:field(partner,true),leg_index:0,fee_leg_index:0,leg_count:1};
    let preview=await funding.preview({relation:'exit',width,walletWitness:witness,hashBinding:binding});
    if(selected.some((n,i)=>preview.action.nullifiers[i]!==n.nullifier||preview.action.input_commitments[i]!==n.commitment))fail('Local exit witness changed.');
    q.nullifiersHash=enhancedHashNullifiers(preview.action.nullifiers,width);q.outputsHash=enhancedHashOutputs(preview.action.output_commitments);
    const digest=familyExitDigest(q);if(digest!==(await both(d.pool,'exitQuoteDigest',[q],block.number))[0])fail('Exit quote digest differs.');
    binding.fee_quote_digest_field=field(BigInt(digest)%FR);
    preview=await funding.preview({relation:'exit',width,walletWitness:witness,hashBinding:binding});
    const rows=[...await dummyPrefix(),...inventory.publicCommitments.filter(n=>n.epoch===source.epoch&&n.row<source.rows).map(n=>n.commitment)],
     queryRows=[...selected.map(n=>n.row),...Array.from({length:width-selected.length},(_,i)=>i+selected.length)];
    if(rows.length!==source.rows||queryRows.some((n,i)=>rows[n]!==preview.action.input_commitments[i]))fail('Authenticated input rows differ.');
    const cache=await funding.publicCache({snapshot:source,rows,queryRows,relation:'exit'});
    const bundle=await funding.prove({relation:'exit',width,walletWitness:preview.walletWitness,hashBinding:binding,authenticatedWalletCache:cache,
     expectedPublicStatement:preview.action.public_statement,expectedCheckpointRef:source.checkpoint,expectedSourceEpoch:source.epoch});
    const aggregate=await funding.provePublicTotal({walletWitness:{schema:'vanta-v8-aggregate-payout-witness-v1',chain_id:r.chainId,
     batch_digest_field:batch,salted_amount_hash:q.saltedAmountHash,public_payout_units:q.payout,private_amount_salt:amountSalt},
     expectedPublicSignals:[batch,field(1),field(q.payout),q.saltedAmountHash,...Array(7).fill(field(0,true)),r.familyTag,field(r.chainId)]});
    const calldata=encodeFamilyExit({domain,q,preview:preview.action,bundle,aggregate,source}),record=await set(id,row=>{
     if(row.phase!=='proving')fail('Exit preparation was cancelled.');return {...row,q,calldata,calldataHash:keccak256(calldata)};});
    await stable(block);await simulate(record);
    await set(id,row=>{if(row.phase!=='proving')fail('Exit preparation was cancelled.');return {...row,phase:'prepared'};});return review(record);
   }catch(error){if(saved)await set(id,row=>row.phase==='proving'?{...row,phase:'failed'}:row);if(reserved)await fences.releaseUnsigned(id);throw error;}
   finally{busy=false;}
  },
  async execute({preparedId}={}){
   live();if(busy)fail('Another exit is in progress.');busy=true;
   try{
    const row=await read(preparedId);if(row.phase!=='prepared')return reconcile(preparedId);
    await simulate(row);if(await approveExit(review(row))!==true)fail('Wallet approval declined.');live();
    await simulate(row);
    await set(preparedId,v=>{if(v.phase!=='prepared')fail('This exit is already being submitted. Reconcile it instead.');return {...v,phase:'submitting'};});
    await fences.armForSubmission(preparedId);
    live();
    const sent=await submitTransaction(Object.freeze({chainId:r.chainId,to:d.pool,value:'0x0',data:row.calldata}));
    live();if(!/^0x[0-9a-f]{64}$/u.test(sent?.transactionHash??''))fail('Wallet transaction hash unavailable. Recover it before retrying.');
    await set(preparedId,v=>({...v,submittedHash:sent.transactionHash}));
    await recordHash(preparedId,sent.transactionHash);return reconcile(preparedId);
   }finally{busy=false;}
  },
  async recover({preparedId,transactionHash}={}){if(transactionHash!==undefined)await recordHash(preparedId,transactionHash);return reconcile(preparedId);},
  async cancel({preparedId}={}){live();if(busy)fail('Wait for the current exit action to finish.');
   await set(preparedId,v=>{if(!['prepared','proving','failed'].includes(v.phase)||v.transactionHash||v.submittedHash||v.settled)fail('Exit submission started. Reconcile it instead.');return {...v,phase:'failed'};});
   await fences.releaseUnsigned(preparedId);return {cancelled:true};},
  async list(){live();const saved=rows(await store.read(namespace)),result=[];
   // Bound RPC concurrency when opening a wallet with a long saved journal.
   for(const row of saved)result.push({...review(row),status:await reconcile(row.id)});return result;},
  async exportRecoveryBackup(){
   live();const key=await backupKey(),iv=randomBytes(12);let plaintext;
   try{plaintext=toUtf8Bytes(JSON.stringify(rows(await store.read(namespace))));live();
    if(plaintext.length>16*1024*1024)fail('Withdrawal recovery backup is too large.');
    return Object.freeze({...backupDomain,iv:hexlify(iv),ciphertext:hexlify(gcm(key,iv,backupAad).encrypt(plaintext))});}
   finally{key.fill(0);plaintext?.fill(0);}
  },
  async importRecoveryBackup(backup){
   live();if(busy)fail('Finish the current withdrawal first.');
   if(!backup||Object.keys(backup).sort().join()!=='ciphertext,generationId,iv,networkId,pool,schema'||
    Object.entries(backupDomain).some(([name,value])=>backup[name]!==value)||!/^0x[0-9a-f]{24}$/u.test(backup.iv??'')||
    typeof backup.ciphertext!=='string'||backup.ciphertext.length>32*1024*1024+34||!/^0x(?:[0-9a-f]{2}){16,}$/u.test(backup.ciphertext))fail('Withdrawal backup belongs to another wallet or compiled pool.');
   busy=true;let key,plain;
   try{
    key=await backupKey();
    plain=gcm(key,getBytes(backup.iv),backupAad).decrypt(getBytes(backup.ciphertext));
    const restored=rows(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));
    const merge=current=>{
     const next=current.slice();for(const item of restored){const old=next.find(v=>v.id===item.id);
      if(old){if(old.calldata!==item.calldata||old.calldataHash!==item.calldataHash||JSON.stringify(old.q)!==JSON.stringify(item.q)||
        JSON.stringify(old.nullifiers)!==JSON.stringify(item.nullifiers)||old.gross!==item.gross)fail('Existing withdrawal differs from its backup.');
       if(terminal(old))continue;
      }
      // A portable backup can predate a broadcast on the original device.
      // Reconcile prepared calldata before permitting any new submission.
      const value={...item,...old,transactionHash:old?.transactionHash??item.transactionHash??null,
       ...(old?.submittedHash||item.submittedHash?{submittedHash:old?.submittedHash??item.submittedHash}:{}),
       phase:item.calldata?'submitting':'failed',settled:false};
      if(old)next[next.indexOf(old)]=value;else next.push(value);
     }
     rows(next);return {next,result:undefined};
    };
    const current=rows(await store.read(namespace));merge(current);live();
    // Reserve in a single CAS before journal adoption. An interrupted adoption
    // leaves conservative locks that retrying this same backup can recover.
    await fences.reserveImported(restored.filter(item=>item.calldata&&!current.some(v=>v.id===item.id&&terminal(v)))
     .map(({id,nullifiers})=>({id,nullifiers})));
    await update(merge);
    return Object.freeze({restored:restored.length});
   }catch{fail('Withdrawal backup is invalid or conflicts with existing pending work.');}
   finally{key?.fill(0);plain?.fill(0);busy=false;}
  },
  dispose(){closed=true;abort();funding.dispose();signal?.removeEventListener('abort',abort);},
 });
 async function recordHash(id,hash){
  if(!/^0x[0-9a-f]{64}$/u.test(hash??''))fail('Invalid transaction hash.');
  const row=await read(id);if(!['prepared','submitting','included','finalized'].includes(row.phase))fail('Exit was not submitted.');
  const [a,b]=await Promise.all([provider.getTransaction(hash),verificationProvider.getTransaction(hash)]);
  live();if(!a||!b)return false;
  if(!same(a.hash,hash)||!same(b.hash,hash)||BigInt(a.chainId)!==BigInt(r.chainId)||BigInt(b.chainId)!==BigInt(r.chainId)||
   !same(a.to,d.pool)||!same(b.to,d.pool)||a.value!==0n||b.value!==0n||!same(a.data,row.calldata)||!same(b.data,row.calldata))fail('Transaction does not match the exact prepared exit.');
  await set(id,v=>{if(!['prepared','submitting','included','finalized'].includes(v.phase))fail('Exit state changed.');
   if(v.phase==='finalized'&&v.transactionHash!==hash)fail('Exit already has a finalized transaction.');
   return {...v,phase:['included','finalized'].includes(v.phase)?v.phase:'submitting',transactionHash:hash};});
  return true;
 }
 }catch(error){abort();funding?.dispose();signal?.removeEventListener('abort',abort);throw error;}
}
