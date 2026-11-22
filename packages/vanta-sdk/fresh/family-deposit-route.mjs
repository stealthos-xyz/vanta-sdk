import {getConfirmedBlock} from './transaction-confirmations.mjs';
/** Resolve one current family receiving route through an untrusted mirror, then check
 * its exact opening and registry state at a block finalized by two RPCs. */
import {AbiCoder,Interface,getAddress,keccak256,toUtf8Bytes} from "ethers";
import {isFamilyAssetSelection} from './family-funding-resources.mjs';

const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const SCOPE=0x565243563201n;
const H32=/^0x[0-9a-f]{64}$/iu;
const DOMAIN=keccak256(toUtf8Bytes("VANTA_PRIVATE_RECEIVING_ROUTE_V2"));
const coder=AbiCoder.defaultAbiCoder();
const routeFields=["schema","chainId","familyTag","generationId","registry","handle","handleId",
  "receiverCommitment","routingCommitment","collectorMpk",
  "viewingPublicKey","receiverSalt"];
const registrarAbi=new Interface([
  "function partnerIdentity(bytes32) view returns(uint256 authorizationCommitment,uint256 receiverCommitment,bytes32 routingCommitment,bytes32 salt,uint64 nextRevision,bool exists)",
  "function isPartnerHandleBound(bytes32) view returns(bool)",
  "function registry() view returns(address)",
  "function handleRegistry() view returns(address)",
  "function ownerVerifier() view returns(address)",
]);
const roleAbi=new Interface([
  "function feeCollector(address,uint8) view returns(bytes32 handleId,uint256 authorizationCommitment,uint256 receiverCommitment,bool active)",
  "function feeCollectorProofCommitment(address,uint8) view returns(uint256)",
  "function feeCollectorRoutingCommitment(address,uint8) view returns(bytes32)",
]);
const exact=(value,keys)=>value&&typeof value==="object"&&
  !Array.isArray(value)&&Object.keys(value).sort().join()===
    keys.slice().sort().join();
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const hash=(value,label,field=false)=>{
  if(typeof value!=="string"||!H32.test(value)||BigInt(value)===0n||
     field&&BigInt(value)>=FR)
    throw Error("Invalid family route "+label+".");
  return value.toLowerCase();
};
const field=(value,label)=>BigInt(hash(value,label,true));
const verified=new WeakSet();
export function assertFamilyDepositRoute(value){
  if(!verified.has(value))
    throw Error("Family receiving route was not checked against confirmed state.");
  return value;
}
export function normalizeFreshHandle(value){
  const name=String(value??"").trim().toLowerCase();
  const handle=name.endsWith(".stealth")?name:name+".stealth";
  if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.stealth$/u.test(handle))
    throw Error("Invalid family .stealth handle.");
  const labels=handle.slice(0,-8).split(".");
  if(labels.length<1||labels.length>2||
     labels.some(label=>label.length<2||label.length>32||
       label.startsWith("-")||label.endsWith("-"))||
     labels.join(".").length<3||labels.join(".").length>48)
    throw Error("Invalid family .stealth handle.");
  return handle;
}
let poseidonPromise;
async function poseidon(values){
  poseidonPromise??=(async()=>{
    const {buildPoseidon}=await import("#vanta-circom-crypto");
    return buildPoseidon();
  })();
  const p=await poseidonPromise;
  return BigInt(p.F.toObject(p(values)));
}
async function readBoth(primary,secondary,block,to,abi,method,args=[]){
  const data=abi.encodeFunctionData(method,args),tx={to,data,blockTag:block};
  const [first,second]=await Promise.all([
    primary.call(tx),secondary.call(tx)]);
  if(!same(first,second))
    throw Error("Family receiving route RPCs disagree on onchain state.");
  return abi.decodeFunctionResult(method,first);
}
async function boundedRecord(response){
  if(response.status!==200||response.redirected||response.type==="opaque"||
     !response.body)
    throw Error("Family receiving route mirror is unavailable.");
  const reader=response.body.getReader();let size=0;const parts=[];
  try{for(;;){const item=await reader.read();if(item.done)break;
    size+=item.value.byteLength;if(size>4096){await reader.cancel();
      throw Error("Family receiving route response is too large.");}
    parts.push(item.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
  catch{throw Error("Family receiving route response is not JSON.");}
  finally{bytes.fill(0);}
}
/** Runtime route opening is funded only after exact onchain authentication. */
export async function resolveFamilyDepositRoute({release,resources,asset,handle,
  provider,verificationProvider,relayerUrl,fetcher=fetch,signal}){
  const chainId=resources.chainId;
  if(!Number.isSafeInteger(chainId)||chainId<=0||!isFamilyAssetSelection(asset)||
     !provider||!verificationProvider||provider===verificationProvider)
    throw Error("Family receiving route needs compiled release and independent RPC.");
  const role=name=>{const rows=release.lock.contracts.filter(r=>r.name===name);
    if(rows.length!==1)throw Error("Missing signed deposit role: "+name);return rows[0];};
  const pool={pool:resources.deployment.pool,modules:{partnerRegistrar:role("partner-registrar"),
    partnerRegistry:role("partner-registry"),handleRegistry:role("handle-registry"),
    partnerOwnerGroth16:role("partner-owner")}};
  if(!pool)throw Error("Family receiving route pool is unavailable.");
  const normalized=normalizeFreshHandle(handle);
  let base;
  try{base=new URL(relayerUrl);}catch{
    throw Error("Family receiving route requires a relayer HTTPS origin.");
  }
  if(base.protocol!=="https:"||base.pathname!=="/"||base.search||
     base.hash||base.username||base.password)
    throw Error("Family receiving route requires a relayer HTTPS origin.");
  const endpoint=new URL("/api/v1/relay/vanta-family/private-routes/resolve",base);
  endpoint.searchParams.set("handle",normalized);
  const response=await boundedRecord(await fetcher(endpoint.href,{
    method:"GET",credentials:"omit",redirect:"error",
    headers:{Accept:"application/json","Cache-Control":"no-store"},signal}));
  if(!exact(response,["success","record","verifiedBlock",
       "verifiedBlockHash"])||response.success!==true||
     !Number.isSafeInteger(response.verifiedBlock)||
     response.verifiedBlock<resources.deployment.deploymentBlock||
     !H32.test(response.verifiedBlockHash)||
     !exact(response.record,routeFields))
    throw Error("Family receiving route has no finalized attestation.");
  const record=response.record;
  const registrar=pool.modules.partnerRegistrar,
    registry=pool.modules.partnerRegistry,
    handles=pool.modules.handleRegistry,
    ownerVerifier=pool.modules.partnerOwnerGroth16;
  if(record.schema!=="vanta-family-private-route-v1"||record.familyTag!==resources.familyTag||record.generationId!==resources.generationId||
     record.chainId!==chainId||record.handle!==normalized||
     getAddress(record.registry)!==getAddress(handles.address))
    throw Error("Family receiving route targets another handle registry.");
  const [chainA,chainB]=await Promise.all([
    provider.getNetwork(),verificationProvider.getNetwork()]);
  if(chainA.chainId!==BigInt(chainId)||chainB.chainId!==BigInt(chainId))
    throw Error("Family receiving route RPC chain differs.");
  const block=response.verifiedBlock,blockHash=response.verifiedBlockHash;
  const [finalA,finalB,atA,atB]=await Promise.all([
    getConfirmedBlock(provider),getConfirmedBlock(verificationProvider),
    provider.getBlock(block),verificationProvider.getBlock(block)]);
  if(!finalA?.hash||!finalB?.hash||finalA.number<block||
     finalB.number<block||!same(atA?.hash,blockHash)||
     !same(atB?.hash,blockHash))
    throw Error("Family receiving route block is not independently confirmed.");
  for(const pin of [registrar,registry,handles,ownerVerifier]){
    const [codeA,codeB]=await Promise.all([
      provider.getCode(pin.address,block),
      verificationProvider.getCode(pin.address,block)]);
    if(codeA==="0x"||codeB==="0x"||
       !same(keccak256(codeA),pin.codehash)||
       !same(keccak256(codeB),pin.codehash))
      throw Error("Family receiving route contract code differs.");
  }
  const id=await poseidon([
    BigInt(keccak256(toUtf8Bytes(normalized))),BigInt(chainId)]);
  if(id<=0n||id>=FR||field(record.handleId,"handle ID")!==id)
    throw Error("Family receiving route handle ID differs.");
  const mpk=field(record.collectorMpk,"collector key"),
    salt=field(record.receiverSalt,"receiver salt"),
    viewKey=hash(record.viewingPublicKey,"viewing key");
  const scope=await poseidon([id,SCOPE]);
  const commitment=await poseidon([mpk,salt,scope]);
  if(commitment!==field(record.receiverCommitment,"receiver commitment"))
    throw Error("Family receiving route does not open its collector.");
  const routingCommitment=keccak256(coder.encode([
    "bytes32","uint256","address","bytes32","uint256","bytes32",
    "bytes32","uint256"],[DOMAIN,BigInt(chainId),getAddress(handles.address),
    record.handleId,mpk,viewKey,record.receiverSalt,commitment]));
  if(!same(routingCommitment,hash(record.routingCommitment,"routing hash")))
    throw Error("Family receiving route record was altered.");
  const [state,bound,linkRegistry,linkHandles,linkVerifier]=
    await Promise.all([
      readBoth(provider,verificationProvider,block,registrar.address,
        registrarAbi,"partnerIdentity",[record.handleId]),
      readBoth(provider,verificationProvider,block,registrar.address,
        registrarAbi,"isPartnerHandleBound",[record.handleId]),
      readBoth(provider,verificationProvider,block,registrar.address,
        registrarAbi,"registry"),
      readBoth(provider,verificationProvider,block,registrar.address,
        registrarAbi,"handleRegistry"),
      readBoth(provider,verificationProvider,block,registrar.address,
        registrarAbi,"ownerVerifier"),
    ]);
  if(getAddress(linkRegistry[0])!==getAddress(registry.address)||
     getAddress(linkHandles[0])!==getAddress(handles.address)||
     getAddress(linkVerifier[0])!==getAddress(ownerVerifier.address))
    throw Error("Family receiving route registrar links differ.");
  const registered=state.exists&&bound[0]===true&&
    BigInt(state.authorizationCommitment)>0n&&
    BigInt(state.receiverCommitment)===commitment&&
    same(state.routingCommitment,routingCommitment);
  const feeRole=normalized==="protocol.stealth"?0:
      normalized==="relayer.stealth"?2:null;
  let activeFeeRole=false,feeRoleAuthorization=0n,
    feeRoleProofCommitment=0n;
  if(feeRole!==null){
    const [fee,proofCommitment,feeRoute]=await Promise.all([
      readBoth(provider,verificationProvider,block,registry.address,
        roleAbi,"feeCollector",[pool.pool,feeRole]),
      readBoth(provider,verificationProvider,block,registry.address,
        roleAbi,"feeCollectorProofCommitment",[pool.pool,feeRole]),
      readBoth(provider,verificationProvider,block,registry.address,
        roleAbi,"feeCollectorRoutingCommitment",[pool.pool,feeRole]),
    ]);
    const expectedProof=await poseidon([mpk,salt]);
    activeFeeRole=fee.active===true&&same(fee.handleId,record.handleId)&&
      BigInt(fee.authorizationCommitment)>0n&&
      BigInt(fee.receiverCommitment)===commitment&&
      BigInt(proofCommitment[0])===expectedProof&&
      same(feeRoute[0],routingCommitment);
    if(activeFeeRole){feeRoleAuthorization=BigInt(fee.authorizationCommitment);
      feeRoleProofCommitment=expectedProof;}
  }
  if(feeRole!==null?!activeFeeRole:!registered)
    throw Error("Family receiving route lacks its registered owner or fee role.");
  if(registered&&activeFeeRole&&
     BigInt(state.authorizationCommitment)!==feeRoleAuthorization)
    throw Error("Family receiving route owner differs from its fee role.");
  const [endA,endB]=await Promise.all([
    provider.getBlock(block),verificationProvider.getBlock(block)]);
  if(!same(endA?.hash,blockHash)||!same(endB?.hash,blockHash))
    throw Error("Family receiving route confirmed block changed.");
  const result=Object.freeze({handle:normalized,handleId:record.handleId,
    collectorMpk:mpk,viewingPublicKey:viewKey,receiverSalt:salt,
    receiverCommitment:commitment,routingCommitment,
    authorizationCommitment:registered?
      BigInt(state.authorizationCommitment):feeRoleAuthorization,
    feeCollectorProofCommitment:feeRoleProofCommitment,
    pool:getAddress(pool.pool),asset,verifiedBlock:block,
    verifiedBlockHash:blockHash.toLowerCase()});
  verified.add(result);return result;
}
