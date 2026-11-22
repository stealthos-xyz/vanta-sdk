/** Encrypted host-store barrier. A signed/uncertain deposit is never retried
 * automatically, including a crash or lost wallet response after submission. */
const allowed=new Set(["prepared","broadcast-uncertain","finalized","expired-unused","failed"]);
const id=v=>{if(typeof v!=="string"||!/^0x[0-9a-f]{64}$/u.test(v))throw Error("Invalid deposit journal identifier.");return v;};
export function createFamilyDepositJournal({store,networkId,generationId,pool}){
 if(typeof store?.read!=="function"||typeof store?.transact!=="function"||
   !store.scope?.startsWith("vanta-host-v1/")||!store.scope.endsWith("/"+networkId+"/"+generationId))
  throw Error("Current encrypted scoped deposit store required.");
 const namespace="family-kzg-deposits-v1/"+pool;
 const check=rows=>{if(!Array.isArray(rows)||rows.length>256||new Set(rows.map(r=>r.preparedId)).size!==rows.length)throw Error("Invalid deposit journal.");
  for(const r of rows){id(r.preparedId);id(r.quoteNonce);if(r.schema!=="vanta-family-kzg-deposit-v1"||
   r.networkId!==networkId||r.generationId!==generationId||r.pool!==pool||!allowed.has(r.phase))throw Error("Deposit journal scope mismatch.");}return rows;};
 const mutate=work=>store.transact(namespace,rows=>work(check(rows)));
 const read=async preparedId=>{const r=check(await store.read(namespace)).find(r=>r.preparedId===id(preparedId));
  if(!r)throw Error("Deposit preparation is absent.");return r;};
 return Object.freeze({
  read,
  list:async()=>check(await store.read(namespace)),
  async reserve(record){id(record.preparedId);id(record.quoteNonce);
   await mutate(rows=>{if(rows.length>=256||rows.some(r=>r.preparedId===record.preparedId||r.quoteNonce===record.quoteNonce))throw Error("Deposit quote already reserved.");
    const next=[...rows,{...record,schema:"vanta-family-kzg-deposit-v1",networkId,generationId,pool,phase:"prepared",transactionHash:null}];check(next);
    return {next,result:undefined};});
   const got=await read(record.preparedId);if(JSON.stringify(got.plan)!==JSON.stringify(record.plan))throw Error("Deposit reservation readback differs.");return got;},
  async arm(preparedId,session){return mutate(rows=>{
   const r=rows.find(row=>row.preparedId===id(preparedId));
   if(!r||r.phase!=="prepared"||r.session.subjectId!==session.subjectId||r.session.sessionId!==session.sessionId||
      r.deadline<=Math.floor(Date.now()/1000))throw Error("Deposit is not eligible for one submission.");
   const spent=rows.filter(row=>row.session.subjectId===session.subjectId&&row.session.sessionId===session.sessionId&&
    ["broadcast-uncertain","finalized"].includes(row.phase)).reduce((n,row)=>n+BigInt(row.amountAtomic),0n);
   if(spent+BigInt(r.amountAtomic)>BigInt(session.maximumSessionDebitAtomic))throw Error("Deposit session budget exceeded.");
   const next=rows.map(row=>row===r?{...r,phase:"broadcast-uncertain"}:row);return {next,result:undefined};});},
  async recordInsufficientFunds(preparedId){return mutate(rows=>{
   const row=rows.find(item=>item.preparedId===id(preparedId));
   // A concurrent observer may already have reconciled this submission.
   if(row?.phase!=="broadcast-uncertain"||row.transactionHash)return {next:rows,result:undefined};
   const next=rows.map(item=>item===row?{...item,phase:"failed",failure:"insufficient-funds"}:item);
   return {next,result:undefined};});},
  async mark(preparedId,phase,transactionHash){if(!["finalized","expired-unused","failed","broadcast-uncertain"].includes(phase))throw Error("Invalid deposit result phase.");
   if(transactionHash!==undefined)id(transactionHash);
   return mutate(rows=>{const r=rows.find(row=>row.preparedId===id(preparedId));if(!r||r.phase==="finalized"&&phase!=="finalized")throw Error("Deposit result would undo finality.");
    return {next:rows.map(row=>row===r?{...r,phase,...(transactionHash?{transactionHash}:{})}:row),result:undefined};});}
 });
}
