import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256} from 'ethers';
import {readSharedFamilyHistory} from '../fresh/family-shared-history.mjs';
import history from '../fresh/generated-family-history-checkpoint.mjs';
import {getCompiledFamilyEvmRelease} from '../fresh/family-network.mjs';
import {getCompiledVantaFamilyProofResources} from '../fresh/family-proof-resources.mjs';
import {selectVantaFamilyFundingResources} from '../fresh/family-funding-resources.mjs';
test('shared public history covers every pinned pool and verifies its decoded bytes',async()=>{
 const release=getCompiledFamilyEvmRelease(),inventory=getCompiledVantaFamilyProofResources(release);
 assert.equal(history.networkId,release.pins.networkId);
 assert.equal(history.generationId,release.pins.generationId);
 assert.equal(Object.keys(history.pools).length,inventory.funding.pools.length);
 const counts=[];
 for(const p of inventory.funding.pools){
  const r=selectVantaFamilyFundingResources(release,inventory,BigInt(p.asset)===0n?'native':p.asset);
  const d=r.deployment,native=r.profiles.normal8.runtime;
  const context={schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:r.chainId,familyTag:r.familyTag,genesisHash:r.genesisHash,generationId:r.generationId,setupId:d.setupId,pool:d.pool,asset:d.asset,poolCodehash:d.poolCodehash,nativeGlueSha256:native.glue.sha256,nativeWasmSha256:native.wasm.sha256};
  const shared=await readSharedFamilyHistory(context,d.deploymentBlock);
  assert.ok(shared);assert.deepEqual(shared.anchor,history.anchor);
  assert.equal(shared.scope,JSON.stringify([context,d.deploymentBlock,true]));
  assert.ok(shared.encryptedRows.every(row=>keccak256(row.envelope)===row.envelopeHash));
  counts.push(shared.encryptedRows.length);
  assert.equal(await readSharedFamilyHistory(context,d.deploymentBlock,history.anchor.number),undefined);
  assert.equal(await readSharedFamilyHistory({...context,generationId:'0x'+'0'.repeat(64)},d.deploymentBlock),undefined);
 }
 assert.equal(counts.reduce((a,b)=>a+b,0),302);
});
