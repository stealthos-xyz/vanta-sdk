/** Internal current account-route transport. Production fixes getRelease to
 * the signed compiled SDK; model inputs cannot select it. */
import {getAddress,verifyMessage,keccak256,toUtf8Bytes} from "ethers";
import {buildVantaFamilyEnhancedConsentMessage} from "./family-enhanced-consent.mjs";
const MAX=512*1024,ID=/^[A-Za-z0-9:_-]{8,128}$/u,HASH=/^0x[0-9a-f]{64}$/u;
const fields={quote:["requestId","width"],prepare:["requestId","width","netPayoutAtomic"],"prepare-batch":["requestId","width","batch"],
  terms:["requestId","outputs"],bind:["requestId","header","nullifiers","envelopes","capabilities"],
  "bind-batch":["requestId","header","nullifiers","envelopes","batch"],sign:["requestId"],
  submit:["requestId","calldata","authorization"],monitor:["requestId"],recover:["requestId"],settlement:["requestId","transactionHash"]};
const fail=()=>{throw Error("Invalid enhanced account request.");};
function snapshot(value,names){
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).length!==names.length||names.some(name=>!Object.hasOwn(value,name))||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>d.get||d.set))fail();
  const encoded=JSON.stringify(value);if(new TextEncoder().encode(encoded).length>MAX)fail();
  return JSON.parse(encoded);
}
export function composeVantaFamilyEnhancedRelayTransport({relayerUrl,context,walletAddress,signConsent,getRelease,store,
  fetcher=globalThis.fetch,signal}={}){
  // The host explicitly configures its HTTPS service origin. Real partners
  // keep their frontend separate; the authenticated fetcher binds each request
  // to that service and the exact chain/generation/pool context below.
  const base=new URL(relayerUrl);
  if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||base.pathname!=="/"||
    typeof fetcher!=="function"||typeof getRelease!=="function"||
    typeof store?.read!=="function"||typeof store?.transact!=="function")fail();
  const wallet=getAddress(walletAddress),fixedContext=Object.freeze({...context});
  // Every request names its immutable chain/generation/pool context. This is
  // routing data, not authority to select a release on the server.
  base.pathname="/api/vanta-v8/enhanced/";
  let disposed=false;
  const namespace="enhanced-consent-v2-"+keccak256(toUtf8Bytes(JSON.stringify([wallet,fixedContext]))).slice(2);
  const rows=value=>{
    if(!Array.isArray(value)||value.length>10000||new Set(value.map(v=>v?.requestId)).size!==value.length)fail();
    for(const row of value){
      snapshot(row,["requestId","intentId","message","authorization","phase","transactionHash"]);
      if(!ID.test(row.requestId)||!ID.test(row.intentId)||typeof row.message!=="string"||row.message.length>4096||
        !["approved","submitting","ambiguous","submitted"].includes(row.phase)||
        row.transactionHash!==null&&!HASH.test(row.transactionHash))fail();
      // Retain old signed journal rows for recovery; new submissions are
      // authorized by the private proof and the in-app confirmation.
      if(row.authorization!==null){
        snapshot(row.authorization,["signature"]);
        if(getAddress(verifyMessage(row.message,row.authorization.signature))!==wallet)fail();
      }
    }
    return value;
  };
  const update=(requestId,change)=>store.transact(namespace,entries=>{
    const all=rows(entries),index=all.findIndex(v=>v.requestId===requestId),old=index<0?null:all[index];
    const record=change(old),next=all.slice();if(index<0)next.push(record);else next[index]=record;
    return {next,result:record};
  });
  const live=()=>{signal?.throwIfAborted();if(disposed)fail();};
  const call=async(action,input)=>{
    live();const value=snapshot(input,action==='quote'&&Object.hasOwn(input??{},'batch')?[...fields.quote,'batch']:fields[action]);if(!ID.test(value.requestId??""))fail();
    if(["quote","prepare","prepare-batch"].includes(action)&&![8,32].includes(value.width))fail();
    if(action==="prepare"&&(typeof value.netPayoutAtomic!=="string"||!/^([1-9][0-9]{0,36})$/u.test(value.netPayoutAtomic)||BigInt(value.netPayoutAtomic)>=1n<<120n))fail();
    if(action==="settlement"&&(!HASH.test(value.transactionHash)||BigInt(value.transactionHash)===0n))fail();
    if(action==="bind"){
      if(!Array.isArray(value.capabilities)||value.capabilities.length!==3)fail();
      const family=getRelease().setup.family.tag;
      value.capabilities=value.capabilities.map((v,slot)=>{
        const c=snapshot(v,["schema","safeForFunds","familyTag","slot","openingHex"]);
        if(c.schema!=="vanta-enhanced-claim-capability-v1"||c.safeForFunds!==false||c.familyTag!==family||c.slot!==slot||
          typeof c.openingHex!=="string"||c.openingHex.length>8192||!/^(?:[0-9a-f]{2})+$/u.test(c.openingHex))fail();return c;
      });
    }
    const response=await fetcher(new URL(action,base).href,{method:"POST",credentials:"omit",redirect:"error",
      headers:{"Content-Type":"application/json",Accept:"application/json",
        "X-StealthOS-Network":fixedContext.networkId,"X-StealthOS-Generation":fixedContext.generationId,
        "X-StealthOS-Pool":fixedContext.pool},body:JSON.stringify(value),signal});
    if(!response.ok){
      if(action==="submit"&&response.status===409&&response.headers.get("content-type")?.includes("application/json")){
        const text=await response.text();
        if(text.length<256){
          const failure=JSON.parse(text);
          if(failure?.success===false&&failure.code==="ENHANCED_INPUTS_RESERVED")
            throw Object.assign(Error("An earlier relayer attempt reserved these private notes."),{code:failure.code});
        }
      }
      throw Error("Enhanced fee service rejected "+action+" (HTTP "+response.status+").");
    }
    if(!response.headers.get("content-type")?.includes("application/json")||Number(response.headers.get("content-length")??0)>MAX)fail();
    const text=await response.text();if(new TextEncoder().encode(text).length>MAX)fail();
    const result=JSON.parse(text);if(!result||Object.keys(result).sort().join()!=="result,success"||result.success!==true)fail();
    live();return result.result;
  };
  return Object.freeze({
    quote:input=>call("quote",input),prepare:input=>call("prepare",input),prepareBatch:input=>call("prepare-batch",input),terms:input=>call("terms",input),
    bind:input=>call("bind",input),bindBatch:input=>call("bind-batch",input),sign:input=>call("sign",input),
    monitor:input=>call("monitor",input),recover:input=>call("recover",input),settlement:input=>call("settlement",input),
    async submissionStatus({requestId}){
      live();if(!ID.test(requestId))fail();const record=rows(await store.read(namespace)).find(v=>v.requestId===requestId);live();
      return Object.freeze({phase:record?.phase??"unsubmitted",transactionHash:record?.transactionHash??null});
    },
    async submit({intentId,requestId,calldata}){
      live();
      const request=Object.freeze({intentId,requestId,pool:fixedContext.pool,asset:fixedContext.assetAddress,calldata});
      const message=buildVantaFamilyEnhancedConsentMessage(getRelease(),fixedContext,request,intentId);
      const old=rows(await store.read(namespace)).find(v=>v.requestId===requestId);live();
      if(old&&old.message!==message)throw Error("An approved request cannot change its calldata or release.");
      if(old?.intentId!==undefined&&old.intentId!==intentId)fail();
      if(old?.phase==="submitted")return {transactionHash:old.transactionHash};
      if(old&&["submitting","ambiguous"].includes(old.phase))
        throw Object.assign(Error("Enhanced submission requires canonical recovery before any retry."),{code:"SUBMISSION_UNRESOLVED"});
      const authorization=old?.authorization??null;
      await update(requestId,existing=>{
        if(existing&&(existing.message!==message||existing.intentId!==intentId))fail();
        return existing??{requestId,intentId,message,authorization,phase:"approved",transactionHash:null};
      });live();
      // Durable compare-and-swap arms the exact user-approved calldata before
      // HTTP. A lost response remains ambiguous across process restarts.
      await update(requestId,existing=>{
        if(existing?.message!==message||existing.phase!=="approved")
          throw Object.assign(Error("Enhanced submission already requires recovery."),{code:"SUBMISSION_UNRESOLVED"});
        return {...existing,phase:"submitting"};
      });live();
      try{
        // Null means no EOA signature, not an unapproved private spend. The
        // caller has confirmed the exact intent; the pool verifies its proof.
        const result=await call("submit",{requestId,calldata,authorization});
        if(!result||Object.keys(result).join()!=="transactionHash"||!HASH.test(result.transactionHash)||BigInt(result.transactionHash)===0n)fail();
        await update(requestId,existing=>{if(existing?.message!==message)fail();return {...existing,phase:"submitted",transactionHash:result.transactionHash};});
        live();return result;
      }catch(error){
        await update(requestId,existing=>{if(existing?.message!==message)fail();return {...existing,phase:"ambiguous"};});throw error;
      }
    },
    dispose(){disposed=true;},
  });
}
