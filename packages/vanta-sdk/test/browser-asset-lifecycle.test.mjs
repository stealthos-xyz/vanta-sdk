// Execute the actual worker's asset-opening branch with delayed/failing host
// adapters. These lifecycle checks do not claim proof or RPC acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const source=(await readFile(new URL('../browser/app-wallet-worker.ts',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const disposal=slice('function disposeAssetHosts()','function dispose()');
const withdrawal=slice('async function withdrawalHost()','async function routedHost(');
const opening=slice('  if (command === "selectAsset")','  if (!enhanced&&');
const js=await transform(`export function harness(adapters){
 let assetRevision=0,epoch=0,enhanced=adapters.oldEnhanced,deposit=adapters.oldDeposit,privateSend,publicWithdrawal,publicWithdrawalPending;
 const withdrawalQuotes=new Map(),controller=new AbortController(),wallet={requireWallet:()=>({publicReceivingIdentity:async()=>({masterPublicKey:1n,viewingPublicKey:new Uint8Array(32)})}),lock:()=>adapters.lock()},backend={lock:()=>adapters.lock(),rememberIfAllowed:async()=>true};
 let config={asset:'native',session:{wallet:'0x01'},relayerUrl:'https://example.invalid',artifactBaseUrl:'https://example.invalid'};
 const store=adapters.store,provider={},independent={},fetcher=()=>{},session={},scope={postMessage(){}},depositAction=false;
 const live=()=>{},fail=()=>{throw Error('Wrong runtime scope');},hexlify=()=> '0x00',secret=()=>{},setTimeout=()=>0;
 const getCompiledFamilyEvmRelease=()=>({lock:{contracts:[{kind:'pool',address:'pool-native'},{kind:'pool',address:'pool-bnm'}]}}),getCompiledVantaFamilyProofResources=()=>({funding:{pools:[{asset:'0x0000000000000000000000000000000000000000',pool:'pool-native'},{asset:'bnm',pool:'pool-bnm'}]}});
 const createVantaFamilyEnhancedHost=adapters.enhanced,createVantaFamilyDepositHost=adapters.deposit,createVantaFamilyWithdrawalHost=adapters.withdrawal;
 const disposeRoutes=()=>{},publicArtifacts=undefined;
 ${disposal}
 ${slice('function enhancedForAsset(', 'function routeForAsset(')}
 ${withdrawal}
 return {async invoke(command,payload){${opening}},withdrawalHost,snapshot:()=>({asset:config.asset,enhanced,deposit,store,publicWithdrawal,assetRevision})};
}`,{loader:'ts',format:'esm',target:'es2022'});
const {harness}=await import('data:text/javascript;base64,'+Buffer.from(js.code).toString('base64'));
const enhanced=asset=>({asset,disposed:0,dispose(){this.disposed++;},host:{context:{asset},getAvailability:()=>({})}});
const deposit=asset=>({asset,disposed:0,dispose(){this.disposed++;},warmWalletClearance:async()=>{},warmProofRuntime:async()=>{}});
function setup(){let locks=0,fail=false;const oldEnhanced=enhanced('native'),oldDeposit=deposit('native'),created=[],store={encryptedJournal:['pending-original']};
 const h=harness({oldEnhanced,oldDeposit,store,lock(){locks++;},enhanced:async({asset})=>{const h=enhanced(asset);created.push(h);return h;},deposit:async({asset})=>{if(fail)throw Error('Public resource unavailable');return deposit(asset);},withdrawal:async()=>enhanced('withdrawal')});
 return{h,oldEnhanced,oldDeposit,created,store,get locks(){return locks;},set fail(v){fail=v;}};
}
test('failed asset initialization keeps the prior unlocked asset and encrypted pending journal',async()=>{
 const f=setup();f.fail=true;await assert.rejects(f.h.invoke('selectAsset',{asset:'bnm'}),/Public resource/);
 assert.equal(f.locks,0);assert.equal(f.oldEnhanced.disposed,0);assert.equal(f.oldDeposit.disposed,0);
 assert.equal(f.created[0].disposed,1);assert.equal(f.h.snapshot().enhanced,f.oldEnhanced);assert.equal(f.h.snapshot().asset,'native');assert.deepEqual(f.store.encryptedJournal,['pending-original']);
 f.fail=false;const result=await f.h.invoke('selectAsset',{asset:'bnm'});assert.equal(result.context.asset,'bnm');assert.equal(f.h.snapshot().asset,'bnm');assert.equal(f.oldEnhanced.disposed,1);assert.equal(f.oldDeposit.disposed,1);assert.equal(f.locks,0);
});
test('an old withdrawal warm-up cannot install a host after a successful asset switch',async()=>{
 let resolve;const late=enhanced('native'),oldEnhanced=enhanced('native'),oldDeposit=deposit('native');
 const h=harness({oldEnhanced,oldDeposit,store:{},lock(){throw Error('Unexpected wallet lock');},enhanced:async({asset})=>enhanced(asset),deposit:async({asset})=>deposit(asset),withdrawal:()=>new Promise(r=>{resolve=r;})});
 const pending=h.withdrawalHost();await h.invoke('selectAsset',{asset:'bnm'});resolve(late);
 await assert.rejects(pending,/Wrong runtime scope/);assert.equal(late.disposed,1);assert.equal(h.snapshot().publicWithdrawal,undefined);assert.equal(h.snapshot().asset,'bnm');
});

test('only failed unsigned preparation drops a proof host; submission outcomes retain it',async()=>{
 const cleanup=slice("    if(['prepareReviewedPrivateSend'",'    const stages:');
 const run=new Function('data','state',`let {privateSend,publicWithdrawal}=state;const routedHosts=state.routedHosts;${cleanup};return {privateSend,publicWithdrawal,routedHosts};`);
 for(const command of ['executePrivateSend','executeRoute','authorizeWithdrawal']){
  const a=enhanced('private'),b=enhanced('route'),c=enhanced('withdraw');
  const next=run({command,payload:{operation:4}},{privateSend:a,publicWithdrawal:c,routedHosts:new Map([[4,b]])});
  assert.equal(a.disposed+b.disposed+c.disposed,0);assert.equal(next.privateSend,a);assert.equal(next.routedHosts.get(4),b);
 }
 const a=enhanced('private'),b=enhanced('route'),c=enhanced('withdraw');
 const next=run({command:'prepareReviewedPrivateSend',payload:{}},{privateSend:a,publicWithdrawal:c,routedHosts:new Map([[4,b]])});
 assert.equal(a.disposed,1);assert.equal(next.privateSend,undefined);assert.equal(b.disposed+c.disposed,0);
 const routed=run({command:'prepareReviewedRoute',payload:{operation:4}},{privateSend:undefined,publicWithdrawal:c,routedHosts:new Map([[4,b]])});
 assert.equal(b.disposed,1);assert.equal(routed.routedHosts.size,0);assert.equal(c.disposed,0);
});
