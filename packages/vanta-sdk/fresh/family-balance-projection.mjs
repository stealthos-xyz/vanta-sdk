/** Display-only change from exact, locally encrypted spend reservations.
 * This never releases a fence or makes a pending output spendable. */
import {createFamilySpendFence} from './family-spend-fence.mjs';
import {availableFamilyDebit} from './family-enhanced-plan.mjs';
export function familyBalanceProjection({notes,reservations,journals,pool,generationId}){
 const units=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/u.test(v)?BigInt(v):null;
 const spendable=notes.filter(n=>n.status==='spendable'),byNullifier=new Map(spendable.map(n=>[n.nullifier,n]));
 const blocked=new Set(reservations.flatMap(r=>r.nullifiers));
 const unreserved=spendable.filter(n=>!blocked.has(n.nullifier)).reduce((s,n)=>s+BigInt(n.opening.amount_units),0n);
 let pendingChange=0n;
 const seen=new Set();
 for(const fence of reservations){
  // A partial/stale observation cannot manufacture an expected output.
  if(fence.nullifiers.some(n=>seen.has(n)||!byNullifier.has(n)))continue;
  const matches=journals.filter(row=>(row.id??row.intentId)===fence.id&&
   (row.pool??row.plan?.domain?.pool)===pool&&
   (row.generationId??row.plan?.domain?.generationId)===generationId&&
   Array.isArray(row.nullifiers)&&row.nullifiers.length===fence.nullifiers.length&&
   new Set(row.nullifiers).size===row.nullifiers.length&&row.nullifiers.every(n=>fence.nullifiers.includes(n)));
  if(matches.length!==1)continue;
  const row=matches[0],debit=units(row.review?.totalDebitAtomic??row.plan?.review?.totalDebitAtomic);
  const input=fence.nullifiers.reduce((s,n)=>s+BigInt(byNullifier.get(n).opening.amount_units),0n);
  if(debit===null||debit<=0n||debit>input)continue;
  fence.nullifiers.forEach(n=>seen.add(n));pendingChange+=input-debit;
 }
 return Object.freeze({projectedBalanceUnits:(unreserved+pendingChange).toString(),pendingChangeBalanceUnits:pendingChange.toString()});
}

/** Aggregate canonical, locally decrypted balances without selecting an asset
 * or constructing additional proving hosts. Reservations remain pool scoped. */
export async function recoverFamilyBalanceSummary({primaryInventory,resources,store,recover,reconcileUnsigned}){
 const fail=()=>{throw Error('Private balances do not share the signed pools and a canonical confirmed block.');};
 const generationId=primaryInventory.context.generationId,anchor={number:primaryInventory.blockNumber,hash:primaryInventory.blockHash};
 if(!resources.length||new Set(resources.map(r=>r.deployment.pool)).size!==resources.length||
  resources[0].deployment.pool!==primaryInventory.context.pool)fail();
 const inventories=await Promise.all(resources.map((r,i)=>i===0?primaryInventory:recover(r,anchor)));
 const parts=await Promise.all(inventories.map(async(inventory,index)=>{
  const r=resources[index],d=r.deployment;
  if(r.generationId!==generationId||!inventory.complete||inventory.context.generationId!==generationId||
   inventory.context.pool!==d.pool||inventory.context.asset!==d.asset||
   inventory.blockNumber!==anchor.number||inventory.blockHash!==anchor.hash)fail();
  // A failed public read keeps the reservation and balance recovery available.
  if(!inventory.resumedDisplayCheckpoint)await reconcileUnsigned?.({resource:r,inventory}).catch(()=>{});
  const reservations=await createFamilySpendFence({store,pool:d.pool}).reservations(),blocked=new Set(reservations.flatMap(row=>row.nullifiers));
  const spendable=inventory.notes.filter(n=>n.status==='spendable'),spent=inventory.notes.filter(n=>n.status==='spent');
  const sum=notes=>notes.reduce((total,n)=>total+BigInt(n.opening.amount_units),0n).toString();
  const journals=reservations.length?(await Promise.all([
   `enhanced-funding-preparations-v1/${d.pool}`,`family-public-withdrawals-v1/${d.pool}`,`family-private-sends-v1/${d.pool}`,
   `family-routed-v1/4/${d.pool}`,`family-routed-v1/5/${d.pool}`
  ].map(name=>store.read(name)))).flat():[];
  return{
   received:inventory.receivedTransactions.map(row=>Object.freeze({...row,pool:d.pool})),
   pool:Object.freeze({asset:d.assetSymbol,assetDecimals:d.assetDecimals,pool:d.pool,
    spendableBalanceUnits:sum(spendable),unreservedBalanceUnits:sum(spendable.filter(n=>!blocked.has(n.nullifier))),
    availableBalanceUnits:availableFamilyDebit(inventory,blocked),
    ...familyBalanceProjection({notes:inventory.notes,reservations,journals,pool:d.pool,generationId}),
    spentBalanceUnits:sum(spent),spendableCount:spendable.length,spentCount:spent.length,verifiedEmpty:inventory.verifiedEmpty}),
  };
 }));
 return Object.freeze({generationId,blockNumber:anchor.number,blockHash:anchor.hash,
  receivedTransactions:Object.freeze(parts.flatMap(p=>p.received)),pools:Object.freeze(parts.map(p=>p.pool))});
}
