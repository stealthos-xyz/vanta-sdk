import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress,id,keccak256,Wallet} from 'ethers';
import {privateSwapOutputAbi as abi,privateSwapOutputScope,privateSwapOutputEscrow} from '../fresh/family-private-swap-output-wire.mjs';
import {depositPoolAbi as poolAbi} from '../fresh/family-deposit-wire.mjs';
import {familyRouteHash} from '../fresh/family-routed-wire.mjs';
import {NATIVE_CLEARANCE_ABI as clearanceAbi,NATIVE_CLEARANCE_TYPES} from '../fresh/family-native-clearance.mjs';
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const poolA=A(11),poolB=A(12),token=A(13),gateway=A(14),implementation=A(15),verifier=A(16),relayer=A(17);
const authority=Wallet.createRandom(),policy=id('fixture-policy');
const release={pins:{networkId:'eip155:6281971',genesisHash:id('genesis'),generationId:id('generation'),setupId:id('setup')},setup:{family:{tag:id('family')}},lock:{contracts:[{name:'private-swap-gateway',address:gateway,codehash:keccak256('0x11')},{name:'private-swap-output-escrow',address:implementation,codehash:keccak256('0x22')},{name:'native-screening-clearance',address:verifier}]}};
const scope=privateSwapOutputScope(release),pools=[{pool:poolA,asset:ZeroAddress,assetSymbol:'DOGE',assetDecimals:18,poolCodehash:id('native-code'),deploymentBlock:1},{pool:poolB,asset:token,assetSymbol:'USDC',assetDecimals:6,poolCodehash:id('token-code'),deploymentBlock:1}];
const inventory={funding:{routes:{nativePool:poolA,usdcPool:poolB},pools}};
const wallet={privateWalletKeys:async()=>({masterSeed:new Uint8Array(32).fill(17)})},resources={profiles:{normal8:{runtime:{glue:{sha256:'11'.repeat(32)},wasm:{sha256:'22'.repeat(32)}}}},chainId:6281971,familyTag:id('family'),genesisHash:id('genesis'),generationId:id('generation')};
const note={commitment:'0x'+'01'.repeat(32),npk:'0x'+'02'.repeat(32),amount_units:'20'},envelope='0x01';
mock.module('../fresh/family-network.mjs',{namedExports:{getCompiledFamilyEvmRelease:()=>release,verifyCompiledFamilyOperationRuntime:async()=>{}}});
mock.module('../fresh/family-proof-resources.mjs',{namedExports:{getCompiledVantaFamilyProofResources:()=>inventory}});
mock.module('../fresh/family-note-delivery.mjs',{namedExports:{createFamilyNoteDelivery:()=>({createOwnedNote:async()=>note,walletRecipient:async()=>({}),encrypt:async()=>envelope,decrypt:async()=>({note})})}});
const {createPrivateSwapHost}=await import('../fresh/family-private-swap-settlement.mjs');
const row0={a:{x:0,y:0},u:{x:0,y:0},aCompressed:id('a'),uCompressed:id('u'),siblings:Array(16).fill(id('sibling'))};
for(const reverse of [false,true])test((reverse?'USDC-to-DOGE':'DOGE-to-USDC')+' screening unavailable before packet and expired packet retry',async()=>{
 const output=reverse?pools[0]:pools[1],input=reverse?pools[1]:pools[0];
 let now=1000,screening=false,route,credit,claimed=false,transaction,receipt,packets=[],posts=[],statusReads=0;
 const sourceTx=id('source'+reverse),outputTx=id('output'+reverse),block=()=>({number:10,timestamp:now,hash:id('block'+now)});
 const provider={getBlock:async tag=>tag==='latest'?{...block(),number:11,parentHash:block().hash}:block(),getCode:async a=>a===gateway?'0x11':'0x22',getLogs:async()=>[],getTransaction:async()=>transaction,getTransactionReceipt:async()=>receipt,
 call:async tx=>{if(tx.to===gateway){const c=abi.parseTransaction(tx);return abi.encodeFunctionResult(c.name,c.name==='credits'?[credit.pool,credit.owner,credit.salt,20,claimed]:c.name==='poolCodeHash'?[output.poolCodehash]:[implementation]);}
 if(tx.to===verifier){const c=clearanceAbi.parseTransaction(tx);return clearanceAbi.encodeFunctionResult(c.name,c.name==='signer'?[authority.address]:c.name==='policyHash'?[policy]:[0]);}
 const c=poolAbi.parseTransaction(tx);return poolAbi.encodeFunctionResult(c.name,c.name==='currentSource'?[0,33,1,2,3]:[policy]);}};
 const saved=new Map(),store={read:async k=>structuredClone(saved.get(k)??[]),transact:async(k,fn)=>{const r=fn(structuredClone(saved.get(k)??[]));saved.set(k,r.next);return r.result;}};
 const review=()=>({preparedId:'intent',phase:'finalized',operation:4,amountAtomic:'10',totalDebitAtomic:'12',transactionHash:sourceTx});
 const source={context:{pool:input.pool},privateOutputRuntime:async()=>({resources,engine:{},rowKeys:async()=>[row0]}),quote:async args=>{route={operation:4,sourcePool:input.pool,sourceAsset:input.asset,payer:relayer,receiver:args.receiver,amount:10,minimumOutput:15,deadline:1500,nonce:id('source'+reverse),maximumDeliveryFee:0,...args.privateOutput};return{quoteId:'q'};},privateOutputAuthority:async()=>({privateOutput:route,sourcePhase:'finalized',sourceBlock:1,route,outputAmountAtomic:'20'}),execute:async()=>review(),reconcile:async()=>review(),list:async()=>[review()],dispose(){},warmProofRuntime:async()=>{}};
 const fetcher=async(url,options)=>{
  const op=new URL(url).pathname.split('/').pop(),body=JSON.parse(options.body);posts.push(op);
  if(op==='clearance'){
   if(!screening)return Response.json({error:'unavailable'},{status:503});
   const c={wallet:body.payer,validAfter:now,validUntil:now+600,walletRevision:0,policyRevision:0};
   const signature=await authority.signTypedData({name:'StealthOS Native Screening',version:'1',chainId:6281971,verifyingContract:verifier},NATIVE_CLEARANCE_TYPES,{...c,policyHash:policy});
   return Response.json({chainId:6281971,generationId:release.pins.generationId,verifier,policyHash:policy,clearance:c,signature});
  }
  if(op==='output-relayer')return Response.json({relayer});
  if(op==='output-status'){statusReads++;return Response.json({transactionHash:null,state:'not-submitted'});}
  assert.equal(op,'output-submit');packets.push(body.calldata);if(packets.length===1)throw Error('interrupted transport');return Response.json({transactionHash:outputTx});
 };
 const open=()=>createPrivateSwapHost({source,walletController:{requireWallet:()=>wallet},store,provider,verificationProvider:provider,relayerUrl:'https://fixture.invalid',fetcher});
 let host=await open();await host.quote({});credit={pool:output.pool,owner:route.owner,salt:route.salt};
 assert.equal(privateSwapOutputEscrow(scope,credit),route.receiver);
 await assert.rejects(host.reconcile({preparedId:'intent'}),/clearance is unavailable/);
 assert.deepEqual(posts,['clearance']);assert.equal(packets.length,0);assert.equal(claimed,false);
 assert.equal((await host.list({cached:true}))[0].phase,'private-output-pending');
 screening=true;
 await assert.rejects(host.reconcile({preparedId:'intent'}),/interrupted transport/);assert.equal(packets.length,1);
 const first=abi.parseTransaction({data:packets[0]});
 assert.equal(first.args[1],0n);assert.equal(first.args[2],1600n);
 now=1700;screening=false;host.dispose();host=await open();
 await assert.rejects(host.reconcile({preparedId:'intent'}),/clearance is unavailable/);
 assert.equal(statusReads,1);assert.equal(packets.length,1);assert.equal(claimed,false);
 assert.equal((await host.list({cached:true}))[0].phase,'private-output-pending');
 screening=true;await host.reconcile({preparedId:'intent'});assert.equal(packets.length,2);
 const second=abi.parseTransaction({data:packets[1]});assert.equal(second.args[0],first.args[0]);assert.equal(second.args[1],1n);assert.equal(second.args[2],2300n);
 const d=poolAbi.parseTransaction({data:second.args[5]}),ev=new Interface(['event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)']);
 const log=ev.encodeEventLog(ev.getEvent('CanonicalEncryptedNote'),[0,33,BigInt(note.commitment),keccak256(envelope),envelope]);
 transaction={data:packets[1],to:gateway,from:relayer,chainId:6281971n,value:0n};receipt={status:1,blockNumber:10,blockHash:block().hash,logs:[{address:output.pool,...log}]};claimed=true;
 const done=await host.reconcile({preparedId:'intent'});assert.equal(done.phase,'finalized');assert.equal(done.outputAmountAtomic,'20');
 assert.equal((await host.reconcile({preparedId:'intent'})).phase,'finalized');assert.equal(packets.length,2);host.dispose();
});
