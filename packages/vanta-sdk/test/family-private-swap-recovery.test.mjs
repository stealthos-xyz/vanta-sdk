import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress,id,keccak256} from 'ethers';
import {privateSwapOutputAbi as abi,privateSwapOutputScope,privateSwapOutputEscrow,derivePrivateSwapOutputSigner} from '../fresh/family-private-swap-output-wire.mjs';
import {depositPoolAbi as poolAbi} from '../fresh/family-deposit-wire.mjs';
import {familyRouteHash} from '../fresh/family-routed-wire.mjs';

// Boundary fixture for the asynchronous journal/transport, not a substitute for
// the genuine Poseidon/KZG and EVM rollback tests in contracts/test.
const pool='0x'+'33'.repeat(20),sourcePool='0x'+'44'.repeat(20),gateway='0x'+'11'.repeat(20),implementation='0x'+'22'.repeat(20),relayer='0x'+'55'.repeat(20);
const release={pins:{networkId:'eip155:6281971',genesisHash:id('genesis'),generationId:id('generation'),setupId:id('setup')},setup:{family:{tag:id('family')}},
 lock:{contracts:[{name:'private-swap-gateway',address:gateway,codehash:keccak256('0x11')},{name:'private-swap-output-escrow',address:implementation,codehash:keccak256('0x22')},
 {name:'native-screening-clearance',address:relayer}]}};
const scope=privateSwapOutputScope(release),inventory={funding:{routes:{nativePool:sourcePool,usdcPool:pool},pools:[{pool,asset:relayer,assetSymbol:'USDC',assetDecimals:18,poolCodehash:id('pool-code'),deploymentBlock:1}]}};
const wallet={privateWalletKeys:async()=>({masterSeed:new Uint8Array(32).fill(17)})},resources={profiles:{normal8:{runtime:{glue:{sha256:'11'.repeat(32)},wasm:{sha256:'22'.repeat(32)}}}},chainId:6281971,familyTag:id('family'),genesisHash:id('genesis'),generationId:id('generation')};
const note={commitment:'0x'+'01'.repeat(32),npk:'0x'+'02'.repeat(32),amount_units:'20'},envelope='0x01';
mock.module('../fresh/family-network.mjs',{namedExports:{getCompiledFamilyEvmRelease:()=>release,verifyCompiledFamilyOperationRuntime:async()=>{}}});
mock.module('../fresh/family-proof-resources.mjs',{namedExports:{getCompiledVantaFamilyProofResources:()=>inventory}});
mock.module('../fresh/family-note-delivery.mjs',{namedExports:{createFamilyNoteDelivery:()=>({createOwnedNote:async()=>note,walletRecipient:async()=>({}),encrypt:async()=>envelope,decrypt:async()=>({note})})}});
mock.module('../fresh/family-native-clearance.mjs',{namedExports:{requireNativeWalletClearance:async()=>({encoded:'0x'})}});
mock.module('../fresh/transaction-confirmations.mjs',{namedExports:{getConfirmedBlock:async()=>({number:10})}});
const {createPrivateSwapHost}=await import('../fresh/family-private-swap-settlement.mjs');

test('source success remains pending; an interrupted output POST resumes exact bytes and completes only with its canonical note',async()=>{
 let phase='included',route,credit,submitted=false,calldata,claimed=false,receipt,transaction,posts=[];
 const sourceTx=id('source-tx'),outputTx=id('output-tx'),block={number:10,timestamp:1000,hash:id('block')};
 const provider={getBlock:async()=>block,getCode:async a=>a===gateway?'0x11':'0x22',getLogs:async()=>[],getTransaction:async()=>transaction,getTransactionReceipt:async()=>receipt,
  call:async tx=>{if(tx.to===gateway){const c=abi.parseTransaction({data:tx.data});return abi.encodeFunctionResult(c.name,c.name==='credits'?[credit.pool,credit.owner,credit.salt,20,claimed]:c.name==='poolCodeHash'?[id('pool-code')]:[implementation]);}
   const c=poolAbi.parseTransaction({data:tx.data});return poolAbi.encodeFunctionResult(c.name,c.name==='currentSource'?[0,33,1,2,3]:[id('fee-policy')]);}};
 const rows=new Map(),store={read:async key=>rows.get(key)||[],transact:async(key,fn)=>{const r=fn(rows.get(key)||[]);rows.set(key,r.next);return r.result;}};
 const review=()=>({preparedId:'intent1',phase,operation:4,amountAtomic:'10',totalDebitAtomic:'12',transactionHash:sourceTx});
 const source={context:{pool:sourcePool},privateOutputRuntime:async()=>({resources,engine:{},rowKeys:async()=>[row0]}),
  quote:async input=>{route={operation:4,sourcePool,sourceAsset:ZeroAddress,payer:relayer,receiver:input.receiver,amount:10,minimumOutput:15,deadline:1500,nonce:id('source-nonce'),maximumDeliveryFee:0,...input.privateOutput};return{quoteId:'q'};},
  privateOutputAuthority:async()=>({privateOutput:route,sourcePhase:phase,sourceBlock:1,route,outputAmountAtomic:'20'}),execute:async()=>review(),reconcile:async()=>review(),list:async()=>[review()],dispose(){},warmProofRuntime:async()=>{}};
 const fetcher=async(url,options)=>{const op=new URL(url).pathname.split('/').pop(),body=JSON.parse(options.body);posts.push(op);
  if(op==='output-relayer')return Response.json({relayer});
  if(op==='output-status')return Response.json({transactionHash:null,state:'not-submitted'});
  calldata=body.calldata;if(!submitted){submitted=true;throw Error('Interrupted transport');}return Response.json({transactionHash:outputTx});};
 const host=await createPrivateSwapHost({source,walletController:{requireWallet:()=>wallet},store,provider,verificationProvider:provider,relayerUrl:'https://app.example.com',fetcher});
 await host.quote({});credit={pool,owner:route.owner,salt:route.salt};assert.equal(privateSwapOutputEscrow(scope,credit),route.receiver);
 assert.equal((await host.execute({})).phase,'included');assert.equal(posts.length,0);
 phase='finalized';
 const cached=await host.list({cached:true});assert.equal(cached.length,1);assert.equal(cached[0].phase,'private-output-pending');
 assert.equal(posts.length,0,'Reading saved history must not start screening or submit an output');
 await assert.rejects(host.reconcile({preparedId:'intent1'}),/Interrupted transport/);const saved=calldata;
 const interrupted=await host.list({cached:true});assert.equal(interrupted[0].phase,'private-output-pending');
 assert.equal(posts.length,2,'Interrupted returns must remain visible without retrying inside list');
 const pending=await host.reconcile({preparedId:'intent1'});assert.equal(pending.phase,'private-output-pending');assert.equal(calldata,saved);assert.deepEqual(posts,['output-relayer','output-submit','output-status','output-submit']);
 const c=abi.parseTransaction({data:calldata}),d=poolAbi.parseTransaction({data:c.args[5]}),e=new Interface(['event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)']);
 const log=e.encodeEventLog(e.getEvent('CanonicalEncryptedNote'),[0,33,BigInt(note.commitment),keccak256(envelope),envelope]);
 transaction={data:calldata,to:gateway,from:relayer,chainId:6281971n,value:0n};receipt={status:1,blockNumber:10,blockHash:block.hash,logs:[{address:pool,...log}]};claimed=true;
 const complete=await host.reconcile({preparedId:'intent1'});assert.equal(complete.phase,'finalized');assert.equal(complete.outputAmountAtomic,'20');assert.equal(complete.outputTransactionHash,outputTx);
 const namespace='family-private-swap-outputs-v2/'+scope.gateway,savedRecords=rows.get(namespace);
 savedRecords[0].sourceId='swap_recovered';savedRecords[0].base={...savedRecords[0].base,preparedId:'swap_recovered'};
 const listed=await host.list();assert.equal(listed.length,1);assert.equal(listed[0].preparedId,'intent1');
 const authority=source.privateOutputAuthority;
 source.list=async()=>[review(),{...review(),preparedId:'public-swap',transactionHash:id('public-swap')}];
 source.privateOutputAuthority=async input=>input.preparedId==='public-swap'?{privateOutput:null,sourcePhase:'finalized'}:authority(input);
 const mixed=await host.list({cached:true});assert.equal(mixed.length,2);
 assert.equal(mixed.find(r=>r.preparedId==='public-swap').privateOutput,undefined,'A public output must never be credited or relabelled as private');
 assert.equal(d.args[0].partnerFeeCap,0n);assert.equal(d.args[0].protocolFeeCap,0n);assert.equal(c.args[4],0n);
 const other=await derivePrivateSwapOutputSigner(wallet,scope,{pool,salt:id('other')});assert.notEqual(other.owner,route.owner);
});
const row0={a:{x:0,y:0},u:{x:0,y:0},aCompressed:id('a'),uCompressed:id('u'),siblings:Array(16).fill(id('sibling'))};
