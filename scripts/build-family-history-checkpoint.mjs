/** Construct a release checkpoint from independent public RPC reads only.
 * Usage: node scripts/build-family-history-checkpoint.mjs PRIMARY VERIFY OUTPUT [BLOCK]
 * The output is reviewed and pinned inside the operator-signed SDK archive.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {JsonRpcProvider} from 'ethers';
import {getCompiledFamilyEvmRelease} from '../packages/vanta-sdk/fresh/family-network.mjs';
import {getCompiledVantaFamilyProofResources} from '../packages/vanta-sdk/fresh/family-proof-resources.mjs';
import {selectVantaFamilyFundingResources} from '../packages/vanta-sdk/fresh/family-funding-resources.mjs';
import {recoverFamilyCanonicalNotes} from '../packages/vanta-sdk/fresh/family-note-recovery.mjs';
import {getSharedConfirmedBlock} from '../packages/vanta-sdk/fresh/transaction-confirmations.mjs';
const [primary,secondary,output,requested]=process.argv.slice(2);
assert.ok(primary&&secondary&&output&&new URL(primary).origin!==new URL(secondary).origin);
const release=getCompiledFamilyEvmRelease(),inventory=getCompiledVantaFamilyProofResources(release);
const chainId=Number(release.pins.networkId.split(':')[1]);
const provider=new JsonRpcProvider(primary,chainId,{batchMaxCount:1,cacheTimeout:-1});
const verificationProvider=new JsonRpcProvider(secondary,chainId,{batchMaxCount:1,cacheTimeout:-1});
const counts=[0,0];
for(const [i,p] of [provider,verificationProvider].entries()){
 const original=p.getLogs.bind(p);p.getLogs=filter=>{counts[i]++;return original(filter)};
}
try{
 const head=await getSharedConfirmedBlock(provider,verificationProvider);
 const number=requested===undefined?head.number-32:Number(requested);
 assert.ok(Number.isSafeInteger(number)&&number<=head.number&&number>=Math.max(...inventory.funding.pools.map(p=>p.deploymentBlock)));
 const anchors=await Promise.all([provider,verificationProvider].map(p=>p.getBlock(number)));
 assert.equal(anchors[0].hash,anchors[1].hash);
 const anchor={number,hash:anchors[0].hash.toLowerCase()};
 const results=await Promise.all(inventory.funding.pools.map(async pin=>{
  const r=selectVantaFamilyFundingResources(release,inventory,BigInt(pin.asset)===0n?'native':pin.asset);
  const d=r.deployment,native=r.profiles.normal8.runtime;
  const context={schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:r.chainId,familyTag:r.familyTag,genesisHash:r.genesisHash,generationId:r.generationId,setupId:d.setupId,pool:d.pool,asset:d.asset,poolCodehash:d.poolCodehash,nativeGlueSha256:native.glue.sha256,nativeWasmSha256:native.wasm.sha256};
  let checkpoint;
  const result=await recoverFamilyCanonicalNotes({provider,verificationProvider,delivery:{context,walletRecipient:async()=>({}),decrypt:async()=>null},wallet:{},deploymentBlock:d.deploymentBlock,confirmedAnchor:anchor,useSharedHistory:false,displayCache:{readCheckpoint:async()=>null,saveCheckpoint:async(_pool,record)=>{checkpoint=structuredClone(record)}}});
  assert.equal(result.complete,true);assert.deepEqual(checkpoint.anchor,anchor);assert.equal(result.publicRows,checkpoint.encryptedRows.length);
  const raw=Buffer.from(JSON.stringify(checkpoint)),compressed=gzipSync(raw,{level:9});
  const name=d.assetSymbol.toLowerCase().replace(/[^a-z0-9-]/g,'-');
  const entry={rawBytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),gzipBase64:compressed.toString('base64')};
  return {pool:d.pool,name,entry,rows:result.publicRows,spends:checkpoint.spentTransactions.length};
 }));
 assert.ok((await Promise.all([provider,verificationProvider].map(p=>p.getBlock(number)))).every(b=>b?.hash?.toLowerCase()===anchor.hash));
 await mkdir(output,{recursive:true});
 for(const p of results)await writeFile(resolve(output,'history-'+p.name+'.json'),JSON.stringify(p.entry));
 const imports=results.map((p,i)=>"import p"+i+" from './history-"+p.name+".json' with {type:'json'};").join('\n');
 const meta={schema:'vanta-family-public-history-checkpoint-v1',networkId:release.pins.networkId,generationId:release.pins.generationId,anchor};
 const pools=results.map((p,i)=>JSON.stringify(p.pool)+':Object.freeze(p'+i+')').join(',');
 await writeFile(resolve(output,'generated-family-history-checkpoint.mjs'),imports+'\nexport default Object.freeze({...'+JSON.stringify(meta)+',pools:Object.freeze({'+pools+'})});\n');
 console.log(JSON.stringify({anchor,requestCounts:counts,pools:results.map(({pool,name,rows,spends,entry})=>({pool,name,rows,spends,sha256:entry.sha256,rawBytes:entry.rawBytes}))}));
}finally{provider.destroy();verificationProvider.destroy();}
