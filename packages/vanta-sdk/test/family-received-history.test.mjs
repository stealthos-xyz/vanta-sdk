import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256} from 'ethers';
import {summarizeFamilyReceivedTransactions,recoverFamilyCanonicalNotes} from '../fresh/family-note-recovery.mjs';
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const note = (tx, amount, extra={}) => ({transactionHash:hash(tx),blockNumber:tx,
  opening:{amount_units:String(amount)},status:'spendable',...extra});
test('incoming public payment survives later spending; change is excluded without a local journal',()=>{
  const result=summarizeFamilyReceivedTransactions([
    note(10,15,{status:'spent',spentTransactionHash:hash(20)}),note(20,7),note(30,4),
  ]);
  assert.deepEqual(result,[{transactionHash:hash(10),blockNumber:10,amountAtomic:'15'},
    {transactionHash:hash(30),blockNumber:30,amountAtomic:'4'}]);
});
test('group only positive locally owned outputs, without exposing private recovery material',()=>{
  const result=summarizeFamilyReceivedTransactions([note(10,5),note(10,2),note(11,0,{status:'nonspendable'}),note(12,0)]);
  assert.deepEqual(result,[{transactionHash:hash(10),blockNumber:10,amountAtomic:'7'}]);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result[0]));
  assert.deepEqual(Object.keys(result[0]).sort(),['amountAtomic','blockNumber','transactionHash']);
});
test('a receipt cannot merge inconsistent canonical block metadata',()=>{
  assert.throws(()=>summarizeFamilyReceivedTransactions([note(10,5),note(10,2,{blockNumber:11})]));
});
test('canonical recovery derives received history from events, never private RPC filters',async()=>{
  const domain={schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:6281971,
    familyTag:'0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445',
    genesisHash:hash(100),generationId:hash(2),setupId:hash(3),pool:'0x'+'11'.repeat(20),
    asset:'0x'+'00'.repeat(20),poolCodehash:keccak256('0x6000'),nativeGlueSha256:'11'.repeat(32),nativeWasmSha256:'22'.repeat(32)};
  const abi=new Interface([
    'function releaseSetupId() view returns(bytes32)','function releaseGenerationId() view returns(bytes32)',
    'function releaseFamilyTag() view returns(bytes32)','function releaseChainId() view returns(uint256)',
    'function releaseGenesisHash() view returns(bytes32)','function asset() view returns(address)',
    'function activeGeneration() view returns(uint64,uint64,uint256)',
    'function sourceSnapshot(uint64) view returns(uint64,uint256,uint256,uint256,bool)',
    'event CanonicalKzgRow(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment)',
    'event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)',
    'event NullifierConsumed(uint256 indexed nullifier,uint8 indexed width)']);
  let head=11,reorg=false,decryptions=0;const filters=[];const logs=[],envelope='0x01'+'00'.repeat(63);
  const push=(name,args,tx)=>logs.push({...abi.encodeEventLog(abi.getEvent(name),args),address:domain.pool,
    blockNumber:4,blockHash:hash(104),transactionHash:hash(tx),index:logs.length});
  for(const [row,commitment,tx]of[[32,5,10],[33,6,20]]){
    push('CanonicalKzgRow',[0,row,commitment],tx);
    push('CanonicalEncryptedNote',[0,row,commitment,keccak256(envelope),envelope],tx);
  }
  push('NullifierConsumed',[7,8],20);
  const values={releaseSetupId:[domain.setupId],releaseGenerationId:[domain.generationId],releaseFamilyTag:[domain.familyTag],
    releaseChainId:[domain.chainId],releaseGenesisHash:[domain.genesisHash],asset:[domain.asset],
    activeGeneration:[0,34,19],sourceSnapshot:[34,12,13,19,false]};
  const provider={getNetwork:async()=>({chainId:6281971n}),getCode:async()=>'0x6000',
    getBlock:async n=>({number:n==='latest'?head:n,hash:hash(reorg&&n===11?999:n==='latest'?head+100:n+100)}),
    call:async r=>abi.encodeFunctionResult(abi.parseTransaction(r).name,values[abi.parseTransaction(r).name]),
    getLogs:async filter=>{filters.push(filter);assert.equal(filter.topics.length,1);return logs.filter(l=>l.blockNumber>=filter.fromBlock&&l.blockNumber<=filter.toBlock);}};
  const delivery={context:domain,walletRecipient:async()=>({}),decrypt:async({commitment})=>{decryptions++;return({
    note:{commitment,amount_units:commitment===hash(5)?'15':'7'},
    verification:{commitment,nullifier:commitment===hash(5)?hash(7):hash(8),nonspendable:false}});}};
  const wallet={},recover=()=>recoverFamilyCanonicalNotes({provider,delivery,wallet,deploymentBlock:0});
  let stored=null;
  const displayCache={async readCheckpoint(){return structuredClone(stored);},
    async saveCheckpoint(pool,checkpoint){assert.equal(pool,domain.pool);stored=structuredClone(checkpoint);}};
  const result=await recoverFamilyCanonicalNotes({provider,delivery,wallet,deploymentBlock:0,displayCache});
  assert.equal(result.balanceAtomicAtAnchor,'7');
  assert.deepEqual(result.receivedTransactions,[{transactionHash:hash(10),blockNumber:4,amountAtomic:'15'}]);
  assert.equal(result.notes[0].spentTransactionHash,hash(20));
  const initialReads=filters.length;assert.equal(decryptions,2);
  assert.deepEqual(await recover(),result);assert.equal(filters.length,initialReads);assert.equal(decryptions,2);
  head=12;logs.push({...abi.encodeEventLog(abi.getEvent('NullifierConsumed'),[8,8]),address:domain.pool,blockNumber:11,blockHash:hash(111),transactionHash:hash(30),index:0});
  const pinned=await recoverFamilyCanonicalNotes({provider,delivery,wallet,deploymentBlock:0,confirmedAnchor:{number:result.blockNumber,hash:result.blockHash}});
  assert.equal(pinned.balanceAtomicAtAnchor,'7');assert.equal(pinned.blockNumber,result.blockNumber);
  for(const confirmedAnchor of[{number:50,hash:hash(150)},{number:10,hash:hash(999)}])
    await assert.rejects(recoverFamilyCanonicalNotes({provider,delivery,wallet,deploymentBlock:0,confirmedAnchor}));
  assert.equal((await recover()).balanceAtomicAtAnchor,'0');assert.equal(filters.at(-1).fromBlock,11);assert.equal(decryptions,2);
  // A fresh provider and private wallet cannot see the former worker cache.
  const reconnected={...provider};
  const resume=options=>recoverFamilyCanonicalNotes({provider:reconnected,delivery,wallet:{},deploymentBlock:0,...options});
  const resumed=await resume({displayCache});
  assert.equal(resumed.balanceAtomicAtAnchor,'0');
  assert.equal(resumed.resumedDisplayCheckpoint,true);
  assert.equal(filters.at(-1).fromBlock,11);
  assert.equal(stored.anchor.number,11);
  const funded=await resume({});
  assert.equal(funded.resumedDisplayCheckpoint,undefined);
  assert.equal(funded.balanceAtomicAtAnchor,'0');
  assert.equal(filters.at(-1).fromBlock,0);

  reorg=true;logs.pop();
  assert.equal((await recover()).balanceAtomicAtAnchor,'7');
  assert.equal(filters.at(-1).fromBlock,0);
  const replacement=await recoverFamilyCanonicalNotes({provider:{...provider},delivery,wallet:{},deploymentBlock:0,displayCache});
  assert.equal(replacement.balanceAtomicAtAnchor,'7');
  assert.equal(replacement.resumedDisplayCheckpoint,undefined);
  assert.equal(filters.at(-1).fromBlock,0);
  const other={...delivery,decrypt:async()=>null};assert.equal((await recoverFamilyCanonicalNotes({provider,delivery:other,wallet:{},deploymentBlock:0})).balanceAtomicAtAnchor,'0');
  await assert.rejects(recoverFamilyCanonicalNotes({provider,delivery:{...delivery,walletRecipient:async()=>{throw Error('locked');}},wallet,deploymentBlock:0}),/locked/);
});
