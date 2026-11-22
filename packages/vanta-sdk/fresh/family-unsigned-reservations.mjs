import {keccak256} from 'ethers';
import {familyNormalAbi} from './family-normal-wire.mjs';
import {canonicalFamilyProvider} from './family-rpc.mjs';
import {createFamilySpendFence} from './family-spend-fence.mjs';

// Balance recovery covers every signed pool. An unsigned failed attempt must
// not depend on selecting that pool again to release its local reservation.
export async function reconcileFamilyUnsignedReservations({store,resource,inventory,provider,verificationProvider,signal}) {
 const pool=resource.deployment.pool,generationId=resource.generationId;
 const fences=createFamilySpendFence({store,pool});
 const reservations=await fences.reservations();
 if(!reservations.length)return;
 const namespaces=[['family-public-withdrawals-v1',0],['family-private-sends-v1',1],['family-routed-v1/4',4],['family-routed-v1/5',5]];
 const spendable=new Set(inventory.notes.filter(note=>note.status==='spendable').map(note=>note.nullifier));
 const sources=[...new Set([provider,verificationProvider].map(canonicalFamilyProvider))];
 const blocks=await Promise.all(sources.map(source=>source.getBlock(inventory.blockNumber)));
 if(blocks.some(block=>block?.hash!==inventory.blockHash||!Number.isSafeInteger(block.timestamp)))return;
 const timestamp=Math.min(...blocks.map(block=>block.timestamp));
 const word=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/u.test(value);
 for(const [prefix,operation] of namespaces) {
  const namespace=prefix+'/'+pool,rows=await store.read(namespace);
  if(!Array.isArray(rows))continue;
  for(const fence of reservations) {
   signal?.throwIfAborted();
   const matches=rows.filter(row=>row?.id===fence.id);
   if(matches.length!==1)continue;
   const row=matches[0];
   if(!['stealthos-family-private-send-v1','stealthos-family-private-send-v2'].includes(row.schema)||
    row.pool!==pool||row.generationId!==generationId||row.q?.pool!==pool||row.q?.mode!==operation||
    !word(row.q?.nonce)||!Number.isSafeInteger(row.q.deadline)||row.q.deadline<=0||row.transactionHash!==undefined||
    !['failed','cancelled','expired-unused','prepared','proving'].includes(row.phase)||
    !Array.isArray(row.nullifiers)||row.nullifiers.length!==fence.nullifiers.length||new Set(row.nullifiers).size!==row.nullifiers.length||
    row.nullifiers.some(value=>!fence.nullifiers.includes(value)||!spendable.has(value)))continue;
   if(row.calldata===undefined ? row.calldataHash!==undefined :
    typeof row.calldata!=='string'||!/^0x(?:[0-9a-f]{2})+$/u.test(row.calldata)||row.calldata.length>524290||keccak256(row.calldata)!==row.calldataHash)continue;
   const failed=['failed','cancelled'].includes(row.phase);
   if((!failed||fence.armed)&&timestamp<=row.q.deadline)continue;
   const request={to:pool,data:familyNormalAbi.encodeFunctionData('usedNonce',[row.q.nonce]),blockTag:inventory.blockNumber};
   const nonces=await Promise.all(sources.map(source=>source.call(request)));
   if(nonces.some(value=>familyNormalAbi.decodeFunctionResult('usedNonce',value)[0]!==false))continue;
   signal?.throwIfAborted();
   // An armed review requires canonical expiry and non-consumption. The
   // unsigned CAS also refuses an attempt another tab has just armed.
   if(fence.armed)await fences.finish(fence.id);
   else await fences.releaseUnsigned(fence.id);
   await store.transact(namespace,current=>({next:current.map(item=>
    item.id===row.id&&JSON.stringify(item)===JSON.stringify(row)?{...item,phase:failed?row.phase:'expired-unused'}:item),result:undefined}));
  }
 }
}
