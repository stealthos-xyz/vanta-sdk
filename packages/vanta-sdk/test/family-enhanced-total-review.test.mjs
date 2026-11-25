import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{familyTotalSpendAmounts,assertFamilyReviewedFees}from'../fresh/family-operation-review.mjs';
import{selectEnhancedNotes,validateEnhancedFeeReview}from'../fresh/family-enhanced-plan.mjs';
import{transform}from'esbuild';
const source=await readFile(new URL('../fresh/family-enhanced-runtime.mjs',import.meta.url),'utf8'),
 expression=source.slice(source.indexOf('const quoteWithdrawal=')+'const quoteWithdrawal='.length,source.indexOf('    return Object.freeze({ host, publicBatch, dispose,quoteWithdrawal,'));
const rules={protocolBps:15,protocolMinimum:'0',partnerBps:20,partnerMinimum:'0',partnerMaximum:((1n<<120n)-1n).toString()},id=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
test('enhanced review deducts fees and all three claim reserves before confirmation without proving',async()=>{
 let serial=0,calls=0,warmCalls=0;const reviews=new Map(),widths=[],now=()=>Math.floor(Date.now()/1000),pool='0x'+'11'.repeat(20),
 publicFees={amountAtomic:'3',protocolFeeAtomic:'1',partnerFeeAtomic:'1',totalDebitAtomic:'5',feeRules:rules,feePolicyHash:id(1),partnerId:id(2),policyVersion:'1',receiverCommitment:'2',authorizationKey:'3',deadline:now()+300};
 const inventory={complete:true,publicCommitments:[],epochs:[{epoch:0}],notes:[{epoch:0,row:32,status:'spendable',nullifier:id(9),opening:{amount_units:'100000000'}}]},
 relay={quote:async({width})=>{calls++;widths.push(width);return{schema:"vanta-enhanced-gas-review-v1",pool,generationId:id(3),width,deadline:now()+300,gasReserveAtomic:"1920000"};},prepare:async({netPayoutAtomic,width})=>{calls++;const n=BigInt(netPayoutAtomic),p=(n*15n+9999n)/10000n,a=(n*20n+9999n)/10000n;
  return{safeForFunds:false,width,id:'fixture'+calls,deadline:now()+300,netPayoutAtomic,notes:[{},{},{}],collectors:[{},{receiverCommitment:'2'},{}],feeSlots:[1,2,3],policy:{protocolBps:15,partnerBps:20,protocolMinimum:'0',partnerMinimum:'0',partnerMaximum:rules.partnerMaximum,feePolicyHash:id(1),partnerId:id(2),partnerVersion:'1',authorizationCommitment:'3'},gas:{authorizationWei:'1000000',claimsWei:['200000','200000','200000'],collectedWei:'1920000'},gasReserveAtomic:'1920000',protocolFeeAtomic:p.toString(),partnerFeeAtomic:a.toString(),totalDebitAtomic:(n+p+a+1920000n).toString()};}};
 let recovered=false;
 const noteRecovery=Promise.withResolvers(),displayCache={};
 let releasePolicy;const policy=new Promise(resolve=>{releasePolicy=resolve;});
 const env={live(){},fail(){throw Error('Invalid review');},amount:v=>BigInt(v),address:v=>v.toLowerCase(),domain:{pool,generationId:id(3)},sessionFor:()=>({expiresAt:now()+1000}),quoteFamilyOperationFees:()=>policy,provider:{},verificationProvider:{},releaseContext:undefined,asset:'native',getReviewDisplayCache:()=>displayCache,recovery:async cache=>{assert.equal(cache,displayCache);await noteRecovery.promise;recovered=true;return inventory;},fences:{blocked:async()=>{assert.ok(recovered,'check reservations after recovery expires unsigned drafts');return new Set();}},selectEnhancedNotes,enhancedRandomField:()=>id(++serial),relay,validateEnhancedFeeReview,familyTotalSpendAmounts,assertFamilyReviewedFees,d:{assetSymbol:'USDC',hostPolicy:{windowEpochs:5}},now,reviews};
 const scheduled=[];
 env.warmProofRuntime=async()=>{warmCalls++;};
 env.setTimeout=work=>scheduled.push(work);
 env.controller={signal:new AbortController().signal};
 const quote=new Function(...Object.keys(env),'return '+expression)(...Object.values(env));
 const pending=quote({amountAtomic:'100000000',destination:'0x'+'22'.repeat(20),enhanced:true,partnerHandle:'fixture.stealth'});
 await new Promise(setImmediate);
 assert.deepEqual(widths,[8],'request the standard gas width while note recovery is pending');
 assert.equal(recovered,false);
 assert.equal(reviews.size,0,'wait for both reads before publishing the review');
 assert.equal(scheduled.length,0,'no warmup scheduled before quote checks finish');
 releasePolicy(publicFees);
 noteRecovery.resolve();
 const q=await pending;
 assert.equal(q.grossAmountAtomic,'100000000');assert.ok(BigInt(q.totalDebitAtomic)<100000000n);
 assert.equal(BigInt(q.netPayoutAtomic)+BigInt(q.protocolFeeAtomic)+BigInt(q.partnerFeeAtomic)+BigInt(q.gasReserveAtomic),BigInt(q.totalDebitAtomic));
 assert.equal(q.gasReserveAtomic,'1920000');assert.equal(calls,1);assert.equal(reviews.get(q.quoteId).input.amountAtomic,q.netPayoutAtomic);
 assert.equal(warmCalls,0,'no proof download before the quote is returned');
 assert.equal(scheduled.length,1);
 scheduled.shift()();
 assert.equal(warmCalls,1);
 await assert.rejects(()=>quote({amountAtomic:'1000000',destination:'0x'+'22'.repeat(20),enhanced:true,partnerHandle:'fixture.stealth'}),/does not cover/);
 assert.equal(scheduled.length,0,'rejected quotes do not start download');
 inventory.notes=Array.from({length:9},(_,i)=>({epoch:0,row:32+i,status:'spendable',nullifier:id(100+i),opening:{amount_units:'12000000'}}));
 const wide=await quote({amountAtomic:'100000000',destination:'0x'+'22'.repeat(20),enhanced:true,partnerHandle:'fixture.stealth'});
 assert.deepEqual(widths,[8,8,8,32]);
 assert.equal(reviews.get(wide.quoteId).width,32);
 assert.match(reviews.get(wide.quoteId).requestId,/_32$/u);
});

test('the wallet posts a successful enhanced quote before scheduling artifact warmup',async()=>{
 const worker=await readFile(new URL('../browser/app-wallet-worker.ts',import.meta.url),'utf8');
 const {code}=await transform(worker.slice(worker.indexOf('let lastId = 0;')),{loader:'ts',target:'es2022'});
 const events=[],scheduled=[],quote=Promise.withResolvers(),controller=new AbortController();
 const scope={addEventListener(_name,handler){this.handle=handler;},postMessage(message){events.push(message.kind);}};
 const runtime=new Function('scope','invokeScoped','controller','publicArtifacts','setTimeout',`
  let busy=false,epoch=0;
  const live=()=>{};
  ${code}
 `);
 runtime(scope,()=>quote.promise,controller,{warmEnhanced:async()=>events.push('warm')},work=>scheduled.push(work));
 const result=scope.handle({data:{id:1,kind:'invoke',command:'quoteWithdrawal',payload:{enhanced:true}}});
 assert.deepEqual(events,[]);
 assert.equal(scheduled.length,0);
 quote.resolve({enhanced:true});
 await result;
 assert.deepEqual(events,['result']);
 assert.equal(scheduled.length,1);
 scheduled.shift()();
 assert.deepEqual(events,['result','warm']);
 await scope.handle({data:{id:2,kind:'invoke',command:'quoteWithdrawal',payload:{enhanced:false}}});
 assert.equal(scheduled.length,0);
});
