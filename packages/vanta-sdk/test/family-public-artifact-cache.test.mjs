import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from 'ethers';
import {createFamilyPublicArtifactCache,enhancedWarmupPins,walletWarmupPins} from '../fresh/family-public-artifact-cache.mjs';
const original=new TextEncoder().encode('public proof artifact fixture'),baseUrl='https://app.example/proofs/';
const pin={path:'objects/key.bin',bytes:original.length,sha256:sha256(original).slice(2)};

test('transient public downloads retry once while corrupted bytes still fail',async()=>{
 for(const failure of ['transport','unavailable','corrupted']){
  let calls=0;
  const cache=createFamilyPublicArtifactCache({baseUrl,pins:[pin],cacheStorage:undefined,fetcher:async()=>{
   calls++;
   if(calls===1){if(failure==='transport')throw TypeError('Failed to fetch');if(failure==='unavailable')return new Response('',{status:503});return new Response(new Uint8Array(original.length));}
   return new Response(original);
  }});
  if(failure==='corrupted'){await assert.rejects(cache.warm(),/SHA-256/);assert.equal(calls,1);}
  else{await cache.warm();assert.equal(calls,2);}
 }
});
function storage(){const rows=new Map();return {rows,async open(){return {async match(key){return rows.get(key.url)?.clone();},async put(key,value){rows.set(key.url,value.clone());},async delete(key){rows.delete(key.url);}};}};}
test('warmup shares downloads with proving and persists authenticated bytes across workers',async()=>{
 const cacheStorage=storage();let downloads=0;
 const fetcher=async()=>{downloads++;await new Promise(r=>setTimeout(r,10));return new Response(original);};
 const cache=createFamilyPublicArtifactCache({baseUrl,pins:[pin],cacheStorage,fetcher});
 const [_,r]=await Promise.all([cache.warm(),cache.fetch(baseUrl+pin.path,{headers:{Range:'bytes=2-6'}})]);
 assert.equal(downloads,1);assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),`bytes 2-6/${original.length}`);
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),original.slice(2,7));
 const reopened=createFamilyPublicArtifactCache({baseUrl,pins:[pin],cacheStorage,fetcher});
 assert.deepEqual(new Uint8Array(await(await reopened.fetch(baseUrl+pin.path)).arrayBuffer()),original);assert.equal(downloads,1);
});
test('corrupt cache is discarded, tampered downloads rejected and failures remain retryable',async()=>{
 const cacheStorage=storage();let tamper=false,downloads=0;
 const fetcher=async()=>{downloads++;return new Response(tamper?new Uint8Array(original.length):original);};
 const cache=createFamilyPublicArtifactCache({baseUrl,pins:[pin],cacheStorage,fetcher});await cache.warm();
 for(const key of cacheStorage.rows.keys())cacheStorage.rows.set(key,new Response('bad'));
 tamper=true;const reopened=createFamilyPublicArtifactCache({baseUrl,pins:[pin],cacheStorage,fetcher});await assert.rejects(reopened.warm(),/SHA-256 or size/);tamper=false;await reopened.warm();assert.equal(downloads,3);
});
test('optional storage failure does not block downloads and unrelated writes never enter cache',async()=>{
 let calls=[];const fetcher=async(input,init)=>{calls.push(init?.method??'GET');return new Response(original);};
 const cache=createFamilyPublicArtifactCache({baseUrl,pins:[pin],cacheStorage:{async open(){throw Error('quota');}},fetcher});
 await cache.warm();await cache.fetch(baseUrl+pin.path,{method:'POST',body:'not cached'});await cache.fetch('https://rpc.example',{method:'POST',body:'{}'});
 assert.deepEqual(calls,['GET','POST','POST']);
});

test('verified range reads reuse bounded worker memory without exposing mutable cached bytes',async()=>{
 const cacheStorage=storage(),disk=await cacheStorage.open();let reads=0,downloads=0;
 const tracked={open:async()=>({...disk,match:async key=>{reads++;return disk.match(key);}})};
 const cache=createFamilyPublicArtifactCache({baseUrl,pins:[pin],cacheStorage:tracked,fetcher:async()=>{downloads++;return new Response(original);}});
 await cache.warm();const buffer=new Uint8Array(await(await cache.fetch(baseUrl+pin.path)).arrayBuffer());buffer.fill(0);
 for(let i=0;i<10;i++)assert.deepEqual(new Uint8Array(await(await cache.fetch(baseUrl+pin.path,{headers:{Range:'bytes=2-6'}})).arrayBuffer()),original.slice(2,7));
 assert.equal(reads,1);assert.equal(downloads,1);
});

test('enhanced review warms only the pinned fee files and shares the download with proving',async()=>{
 const matrix=new TextEncoder().encode('enhanced matrix fixture');
 const query=new TextEncoder().encode('enhanced query fixture');
 const enhancedPin={path:'objects/enhanced-query.bin',bytes:query.length,sha256:sha256(query).slice(2)};
 const otherPin={path:'objects/enhanced-matrix.bin',bytes:matrix.length,sha256:sha256(matrix).slice(2)};
 const enhancedPins=enhancedWarmupPins({profiles:{enhanced:{matrix:otherPin,queries:{H:enhancedPin}}}});
 const downloads=[],pending=Promise.withResolvers(),started=Promise.withResolvers();
 const cache=createFamilyPublicArtifactCache({baseUrl,pins:[pin],enhancedPins,cacheStorage:storage(),fetcher:async url=>{
  downloads.push(url);
  if(url===baseUrl+otherPin.path){started.resolve();await pending.promise;return new Response(matrix);}
  return new Response(url===baseUrl+enhancedPin.path?query:original);
 }});
 await cache.warm();
 assert.deepEqual(downloads,[baseUrl+pin.path]);
 const first=cache.warmEnhanced(),second=cache.warmEnhanced();
 assert.equal(first,second);
 await started.promise;
 const proving=cache.fetch(baseUrl+otherPin.path,{headers:{Range:'bytes=2-6'}});
 pending.resolve();
 const result=await proving;
 assert.equal(result.status,206);
 assert.deepEqual(new Uint8Array(await result.arrayBuffer()),matrix.slice(2,7));
 await first;
 await cache.warmEnhanced();
 assert.deepEqual(downloads,[pin,otherPin,enhancedPin].map(p=>baseUrl+p.path));
});

// Every outgoing operation shares these normal proof profiles, including routes.
test('wallet artifact warmup includes both proof widths and deduplicates shared resources',()=>{
 const mk=n=>({path:String(n),bytes:n,sha256:String(n).padStart(64,'0')}),p={runtime:{glue:mk(1),wasm:mk(2)},m2Manifest:mk(3),matrixManifest:mk(4),publicMaterial:mk(5),m2Key:mk(6),matrix:mk(7)};
 const i={profiles:{combined:{runtime:p.runtime,queries:{}},normal8:p,normal32:{...p,m2Key:mk(8)}},partnerPolicyKzg:{},funding:{publicCache:{runtime:{}}}};
 const pins=walletWarmupPins(i);assert.ok(pins.some(x=>x.path==='8'));assert.equal(pins.filter(x=>x.path==='6').length,1);
});
