/** Fetch Request handler for a partner-owned, server-only current family deposit signer.
 * All five gates are caller supplied and mandatory. In particular,
 * approveIntent must durably reserve the exact intent before signing. */
import {createHash,timingSafeEqual} from "node:crypto";
import {getAddress,isHexString} from "ethers";
import {getCompiledFamilyEvmRelease} from "../fresh/family-network.mjs";
import {getCompiledVantaFamilyProofResources} from "../fresh/family-proof-resources.mjs";

const PATH="/api/vanta-v8/partner/authorize";
const H32=/^0x[0-9a-f]{64}$/u;
const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const CAP=(1n<<128n)-1n;
const REQUEST_KEYS=["payer","count","gross","protocolFeeCap",
  "partnerFeeCap","outputsHash","envelopesHash","feeSlotsHash",
  "feeTermsHash","partnerRegistryRoot"];
const AUTH_KEYS=["handleId","signerSalt","requestNonce","deadline",
  "signature"];
const exact=(value,keys)=>value&&typeof value==="object"&&
  !Array.isArray(value)&&Object.keys(value).sort().join()===
    keys.slice().sort().join();
const numeric=(value,max)=>typeof value==="string"&&
  /^(0|[1-9][0-9]*)$/u.test(value)&&value.length<=80&&
  BigInt(value)<=max;
const hash=value=>typeof value==="string"&&H32.test(value);
const headers={"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff"};
const reply=(status,body)=>new Response(JSON.stringify(body),
  {status,headers});

/** Optional constant-time proxy authentication for verifySession. The secret
 * must come from a server-only vault, never from the browser request body. */
export function verifyFamilyPartnerProxySecret(webRequest,expectedSecret){
  const received=webRequest?.headers?.get("x-stealthos-partner-proxy");
  if(typeof expectedSecret!=="string"||
     !/^[0-9a-f]{64}$/u.test(expectedSecret)||
     typeof received!=="string"||
     !/^[0-9a-f]{64}$/u.test(received))return false;
  return timingSafeEqual(Buffer.from(received,"hex"),
    Buffer.from(expectedSecret,"hex"));
}

async function boundedBody(webRequest){
  const sizeHeader=webRequest.headers.get("content-length");
  if(sizeHeader!==null&&(!/^[0-9]+$/u.test(sizeHeader)||
     Number(sizeHeader)>8192))throw Error("size");
  if(!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
    webRequest.headers.get("content-type")??"")||!webRequest.body)
    throw Error("content type");
  const reader=webRequest.body.getReader(),parts=[];
  let size=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;
      size+=part.value.byteLength;
      if(size>8192){await reader.cancel();throw Error("size");}
      parts.push(part.value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
  finally{bytes.fill(0);}
}

function intentFromBody(body,release,inventory){
  if(!exact(body,["networkId","generationId","asset","handleId","request"])||
     body.networkId!==release.pins.networkId||body.generationId!==release.pins.generationId||
     inventory.funding.pools.filter(p=>p.assetSymbol===body.asset).length!==1||!hash(body.handleId)||
     BigInt(body.handleId)<=0n||BigInt(body.handleId)>=FR||
     !exact(body.request,REQUEST_KEYS))throw Error("intent");
  const r=body.request;
  if(r.count!==3||!numeric(r.gross,CAP)||BigInt(r.gross)<=0n||
     !numeric(r.protocolFeeCap,CAP)||!numeric(r.partnerFeeCap,CAP)||
     BigInt(r.protocolFeeCap)!==0n||BigInt(r.partnerFeeCap)>=BigInt(r.gross)||
     !numeric(r.feeTermsHash,FR-1n)||BigInt(r.feeTermsHash)===0n||
     !numeric(r.partnerRegistryRoot,FR-1n)||
     BigInt(r.partnerRegistryRoot)===0n||
     ![r.outputsHash,r.envelopesHash,r.feeSlotsHash].every(hash))
    throw Error("intent");
  const request=Object.freeze({payer:getAddress(r.payer),count:3,
    gross:r.gross,protocolFeeCap:r.protocolFeeCap,
    partnerFeeCap:r.partnerFeeCap,
    outputsHash:r.outputsHash.toLowerCase(),
    envelopesHash:r.envelopesHash.toLowerCase(),
    feeSlotsHash:r.feeSlotsHash.toLowerCase(),
    feeTermsHash:r.feeTermsHash,partnerRegistryRoot:r.partnerRegistryRoot});
  if(request.payer==="0x0000000000000000000000000000000000000000")
    throw Error("payer");
  const intent=Object.freeze({networkId:body.networkId,generationId:body.generationId,asset:body.asset,
    handleId:body.handleId.toLowerCase(),request});
  const intentId="0x"+createHash("sha256").update(
    JSON.stringify(intent)).digest("hex");
  return Object.freeze({...intent,intentId});
}

/** Build a web-standard POST handler for a trusted partner host.
 * verifyOrigin validates direct same-origin or a secret-authenticated proxy;
 * verifySession validates the caller; verifyCsrf validates its CSRF assertion;
 * approveIntent atomically reserves owner-approved intentId and budget;
 * loadPartnerWallet loads the distinct partner credential only on this host.
 */
export function createFamilyPartnerAuthorizationHandler({verifyOrigin,
  verifySession,verifyCsrf,approveIntent,loadPartnerWallet}={}){
  if([verifyOrigin,verifySession,verifyCsrf,approveIntent,
      loadPartnerWallet].some(fn=>typeof fn!=="function"))
    throw Error("All family partner host authorization gates are required.");
  const release=getCompiledFamilyEvmRelease(),inventory=getCompiledVantaFamilyProofResources(release);
  return async function handle(webRequest){
    let url;
    try{url=new URL(webRequest.url);}catch{return reply(404,{error:"Unavailable"});}
    if(webRequest.method!=="POST")
      return new Response(JSON.stringify({error:"Method not allowed"}),
        {status:405,headers:{...headers,Allow:"POST"}});
    if(url.protocol!=="https:"||url.pathname!==PATH||url.search||url.hash||
       url.username||url.password)
      return reply(404,{error:"Unavailable"});
    let session;
    try{
      if(await verifyOrigin(webRequest)!==true)return reply(403,{error:"Denied"});
      session=await verifySession(webRequest);
      if(!session||typeof session!=="object"||
         await verifyCsrf({webRequest,session})!==true)
        return reply(403,{error:"Denied"});
    }catch{return reply(403,{error:"Denied"});}
    let intent;
    try{intent=intentFromBody(await boundedBody(webRequest),release,inventory);}
    catch{return reply(400,{error:"Invalid intent"});}
    let approved;
    try{approved=await approveIntent(Object.freeze({session,...intent}));}
    catch{return reply(403,{error:"Denied"});}
    if(!exact(approved,["approved","reservationId"])||
       approved.approved!==true||typeof approved.reservationId!=="string"||
       approved.reservationId.length<1||approved.reservationId.length>128)
      return reply(403,{error:"Denied"});
    let wallet;
    try{
      wallet=await loadPartnerWallet(Object.freeze({session,networkId:intent.networkId,generationId:intent.generationId,asset:intent.asset,
        handleId:intent.handleId,reservationId:approved.reservationId}));
      if(typeof wallet?.signFamilyDepositQuoteAuthorization!=="function"||
         typeof wallet?.dispose!=="function")
        throw Error("host wallet unavailable");
      const auth=await wallet.signFamilyDepositQuoteAuthorization(Object.freeze({
        networkId:intent.networkId,generationId:intent.generationId,asset:intent.asset,handleId:intent.handleId,
        request:intent.request}));
      const now=Math.floor(Date.now()/1000);
      if(!exact(auth,AUTH_KEYS)||!hash(auth.handleId)||
         auth.handleId.toLowerCase()!==intent.handleId||
         !hash(auth.signerSalt)||BigInt(auth.signerSalt)<=0n||
         BigInt(auth.signerSalt)>=FR||!hash(auth.requestNonce)||
         BigInt(auth.requestNonce)===0n||
         !Number.isSafeInteger(auth.deadline)||auth.deadline<=now+30||
         auth.deadline>now+300||!isHexString(auth.signature,65))
        throw Error("invalid host signature");
      return reply(200,{handleId:auth.handleId,
        signerSalt:auth.signerSalt,requestNonce:auth.requestNonce,
        deadline:auth.deadline,signature:auth.signature});
    }catch{return reply(503,{error:"Partner authorization unavailable"});}
    finally{try{wallet?.dispose();}catch{/* do not reveal host state */}}
  };
}
