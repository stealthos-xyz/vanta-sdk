import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hexlify,randomBytes} from 'ethers';
import {selectFamilyPrivateSendNotes} from '../fresh/family-normal-selection.mjs';
import {familyTotalSpendAmounts} from '../fresh/family-operation-review.mjs';

const source=await readFile(new URL('../fresh/family-normal-host.mjs',import.meta.url),'utf8');
const inventorySource=source.slice(source.indexOf(' const inventory='),source.indexOf(' const review=row=>'));
const quoteSource=source.slice(source.indexOf('  async quote(input){'),source.indexOf('  async prepareReviewed(')).trim().replace(/,$/u,'');
const id=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const rules={protocolBps:15,protocolMinimum:'0',partnerBps:20,partnerMinimum:'0',partnerMaximum:((1n<<120n)-1n).toString()};
for(const operation of [0,1])for(const width of [8,32])test('read-only quote overlaps live policy and gas, uses display cursor and retains exact width '+operation+'/'+width,async()=>{
 const cache={},pending=Promise.withResolvers(),policy=Promise.withResolvers(),widths=[],scans=[],events=[],quotes=new Map();
 const d={pool:address(1),asset:address(0),deploymentBlock:1},r={generationId:id(7)},available={complete:true,publicCommitments:[],epochs:[{epoch:0}],notes:Array.from({length:width===8?1:9},(_,i)=>({epoch:0,row:32+i,status:'spendable',nullifier:id(i+1),opening:{amount_units:width===8?'10000':'1200'}}))};
 const provider={},verificationProvider={},delivery={},wallet={};
 const env={provider,verificationProvider,delivery,wallet,d,r,releaseContext:undefined,operation,routed:false,privateScope:false,asset:'native',quotes,
  getReviewDisplayCache:()=>cache,
  recoverFamilyCanonicalNotes:async options=>{scans.push(options.displayCache);if(options.displayCache){await pending.promise;}return available;},
  fences:{blocked:async()=>new Set()},selectFamilyPrivateSendNotes,hexlify,randomBytes,
  prepareFamilyOperationFeeReview:async()=>{events.push('policy');await policy.promise;return async({amountAtomic,maximumDebitAtomic,gasReserveAtomic})=>({...familyTotalSpendAmounts({maximumDebitAtomic,gasReserveAtomic,feeRules:rules}),grossAmountAtomic:amountAtomic,deadline:Math.floor(Date.now()/1000)+300});},
  post:async(kind,body)=>{assert.equal(kind,'gas');widths.push(body.width);events.push('gas');assert.deepEqual(Object.keys(body).sort(),['asset','maximumDeliveryFee','operation','partnerHandle','width']);return{schema:'stealthos-family-relay-gas-v1',pool:d.pool,asset:d.asset,generationId:r.generationId,operation,width:body.width,relayWallet:address(5),gasReserveAtomic:'50',token:'fixture',expiresAt:Math.floor(Date.now()/1000)+300};},
  live(){},fail(message){throw Error(message);}
 };
 const harness=new Function(...Object.keys(env),inventorySource+"const api={warmProofRuntime:async()=>{events.push('warm');},"+quoteSource+"};return {api,inventory};")(...Object.values(env));
 const quote=harness.api.quote({amountAtomic:'9000',recipient:address(9),partnerHandle:'fixture.stealth'});
 await new Promise(setImmediate);
 assert.deepEqual(events,['gas','policy','warm']);assert.deepEqual(widths,[8]);assert.deepEqual(scans,[cache]);assert.equal(quotes.size,0);
 pending.resolve();policy.resolve();
 const result=await quote;
 assert.equal(quotes.get(result.quoteId).gas.width,width);assert.deepEqual(widths,width===8?[8]:[8,32]);assert.ok(BigInt(result.totalDebitAtomic)<=9000n);
 // The funded inventory function is independent of the display adapter.
 await harness.inventory();assert.deepEqual(scans,[cache,undefined]);
});
