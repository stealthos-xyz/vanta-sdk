/** One encrypted CAS reservation shared by ordinary withdrawals and public
 * recovery exits. Armed reservations survive errors and SDK updates. */
export function createFamilySpendFence({store,pool}){
 const namespace='family-spend-fences-v1/'+pool;
 const fail=()=>{throw Error('Selected private notes are reserved by another operation. Reconcile it before retrying.');};
 const valid=rows=>{
  if(!Array.isArray(rows)||rows.length>512||new Set(rows.map(r=>r?.id)).size!==rows.length)fail();
  for(const r of rows)if(!/^[A-Za-z0-9_-]{1,128}$/u.test(r.id??'')||typeof r.armed!=='boolean'||
   !Array.isArray(r.nullifiers)||r.nullifiers.length<1||r.nullifiers.length>32||
   r.nullifiers.some(n=>!/^0x[0-9a-f]{64}$/u.test(n))||new Set(r.nullifiers).size!==r.nullifiers.length)fail();
  return rows;
 };
 const update=fn=>store.transact(namespace,rows=>fn(valid(rows)));
 return Object.freeze({
  async reservations(){return valid(await store.read(namespace)).map(r=>({...r,nullifiers:[...r.nullifiers]}));},
  async blocked(){return new Set(valid(await store.read(namespace)).flatMap(r=>r.nullifiers));},
  reserve({id,nullifiers}){return update(rows=>{
   const next={id,nullifiers:[...nullifiers],armed:false};valid([next]);
   const old=rows.find(r=>r.id===id);
   if(old){if(JSON.stringify(old.nullifiers)!==JSON.stringify(nullifiers))fail();return {next:rows,result:undefined};}
   if(rows.length>=512||rows.some(r=>r.nullifiers.some(n=>nullifiers.includes(n))))fail();
   return {next:[...rows,next],result:undefined};
  });},
  // Import the entire portable journal in one CAS, before saving its rows.
  // A conflict must never leave only part of a backup reserved.
  reserveImported(items){return update(rows=>{
   valid(items.map(r=>({...r,armed:true})));const next=rows.slice();
   for(const item of items){
    const old=next.find(r=>r.id===item.id);
    if(old){if(JSON.stringify(old.nullifiers)!==JSON.stringify(item.nullifiers))fail();}
    else if(next.some(r=>r.nullifiers.some(n=>item.nullifiers.includes(n))))fail();
    if(old)next[next.indexOf(old)]={...old,armed:true};else next.push({...item,armed:true});
   }
   valid(next);return {next,result:undefined};
  });},
  // A restored journal is already armed and must never dispatch again.
  armForSubmission(id){return update(rows=>{
   const row=rows.find(r=>r.id===id);if(!row||row.armed)fail();
   return {next:rows.map(r=>r===row?{...r,armed:true}:r),result:undefined};
  });},
  arm(id){return update(rows=>{if(!rows.some(r=>r.id===id))fail();return {next:rows.map(r=>r.id===id?{...r,armed:true}:r),result:undefined};});},
  releaseUnsigned(id){return update(rows=>{if(rows.find(r=>r.id===id)?.armed)fail();return {next:rows.filter(r=>r.id!==id),result:undefined};});},
  // Only call after canonical finalized nullifier/receipt reconciliation.
  finish(id){return update(rows=>({next:rows.filter(r=>r.id!==id),result:undefined}));},
 });
}
