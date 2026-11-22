import {getConfirmedBlock} from './transaction-confirmations.mjs';
import {canonicalFamilyProvider} from './family-rpc.mjs';
/**
 * Current KZG family release validation. Signed setup, network deployment and
 * generation pins are compiled independently and checked before opening a
 * wallet, generating proofs, or submitting transactions. Unconfigured builds
 * cannot activate a release.
 */
import {getAddress,getBytes,keccak256,sha256,toUtf8Bytes,verifyMessage} from "ethers";
import {COMPILED_FAMILY_RELEASE_JSON,
  COMPILED_FAMILY_RELEASE_SHA256,COMPILED_FAMILY_HISTORY_JSON}
  from "./generated-family-release.mjs";
import {validateVantaFamilyProofConfiguration,validateVantaFamilyProofResources} from "./family-proof-resources.mjs";
import {COMPILED_FAMILY_CATALOG_JSON,COMPILED_FAMILY_CATALOG_SHA256} from './generated-family-catalog.mjs';
import {validateFamilyKzgCatalog,freezeFamilyCatalogValue} from './family-catalog-core.mjs';
const releaseContexts=new WeakMap();let compiledCatalog,compiledRelease;

const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const WORD=/^0x[0-9a-fA-F]{64}$/u;
const SHA=/^[0-9a-f]{64}$/u;
const ID=/^[a-z][a-z0-9-]{1,31}$/u;
const NAME=/^[a-z][a-z0-9-]{0,63}$/u;
const nonzeroSha=value=>SHA.test(value??"") && BigInt("0x"+value)!==0n;
const fail=message=>{throw Error("SDK family release: "+message);};
const check=(ok,message)=>{if(!ok)fail(message);};
const canonical=value=>{
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value && typeof value==="object")return "{"+
    Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+
      canonical(value[key])).join(",")+"}";
  check(value!==undefined && !(typeof value==="number" &&
    !Number.isSafeInteger(value)),"noncanonical manifest");
  return JSON.stringify(value);
};
const exact=(value,keys,label)=>check(value && typeof value==="object" &&
  !Array.isArray(value) && Object.keys(value).sort().join(",")===
    [...keys].sort().join(","),"invalid "+label);
const digest=value=>keccak256(toUtf8Bytes(canonical(value)));
const familyTag=family=>{
  check(ID.test(family?.id??"") && family.namespace==="eip155",
    "unsupported ceremony family; non-EVM adapters are not enabled");
  const hash=keccak256(toUtf8Bytes(
    `STEALTHOS_VANTA_CEREMONY_FAMILY_V1:eip155:${family.id}`));
  return "0x"+(BigInt(hash)%FR).toString(16).padStart(64,"0");
};
const signCheck=(message,signature,authority,label)=>{
  let result;
  try{result=verifyMessage(getBytes(message),signature);}catch{fail(label+" signature invalid");}
  check(result===getAddress(authority),label+" signer differs");
};

/** Pins are independent constants in a reviewed, byte-pinned SDK package. */
export function assertPinnedFamilyEvmManifest({setup,activation,lock,pins,
  networkPolicy}){
  exact(pins,["familyId","networkId","genesisHash","setupId",
    "generationId","lockId","relayerConfigSha256",
    "networkPolicySha256"],"SDK build pins");
  exact(setup,["schema","family","ceremonyId","sourceNetwork","ceremonyReleaseHash",
    "transcriptSha256","verifierKeysSha256","constructionPlanSha256",
    "circuitInventorySha256","artifactInventorySha256","beaconAnchors",
    "setupId"],"setup");
  exact(setup.family,["id","namespace","tag","activationAuthority"],
    "family");
  exact(setup.beaconAnchors,["phase1","terminal"],"beacon anchors");
  exact(setup.sourceNetwork,["chainId","name"],"source network");
  const {setupId,...setupBody}=setup;
  check(setup.schema==="stealthos-reusable-family-setup-v1" &&
    setup.setupId===digest(setupBody) && setup.setupId===pins.setupId &&
    setup.family.id===pins.familyId &&
    Number.isSafeInteger(setup.sourceNetwork.chainId) &&
    setup.sourceNetwork.chainId>0 &&
    typeof setup.sourceNetwork.name==="string" &&
    setup.sourceNetwork.name.trim().length>0 &&
    setup.family.tag===familyTag(setup.family) &&
    getAddress(setup.family.activationAuthority)===
      setup.family.activationAuthority &&
    setup.family.activationAuthority!==
      "0x0000000000000000000000000000000000000000" &&
    ID.test(setup.ceremonyId) &&
    ["ceremonyReleaseHash","transcriptSha256","verifierKeysSha256",
      "constructionPlanSha256","circuitInventorySha256",
      "artifactInventorySha256"].every(name=>nonzeroSha(setup[name])) &&
    nonzeroSha(setup.beaconAnchors.phase1) &&
    nonzeroSha(setup.beaconAnchors.terminal),
  "setup identity differs from separately compiled family pins");
  exact(networkPolicy,["schema","familyId","sourceNetworkId","networks"],
    "reviewed chain-family policy");
  check(networkPolicy.schema==="stealthos-reviewed-family-networks-v1" &&
    networkPolicy.familyId===setup.family.id &&
    networkPolicy.sourceNetworkId==="eip155:"+setup.sourceNetwork.chainId &&
    SHA.test(pins.networkPolicySha256??"") &&
    sha256(toUtf8Bytes(canonical(networkPolicy))).toLowerCase()===
      "0x"+pins.networkPolicySha256 &&
    Array.isArray(networkPolicy.networks) &&
    networkPolicy.networks.length>0&&networkPolicy.networks.length<=8,
  "missing independently pinned network-family membership");
  const members=new Set();
  for(const net of networkPolicy.networks){
    exact(net,["id","genesisHash","role"],"reviewed network");
    check(/^eip155:[1-9][0-9]*$/u.test(net.id) &&
      !members.has(net.id) &&
      ["mainnet","testnet"].includes(net.role) &&
      WORD.test(net.genesisHash??"") &&
      BigInt(net.genesisHash)!==0n &&
      net.genesisHash===net.genesisHash.toLowerCase(),
    "invalid or duplicate reviewed family membership");
    members.add(net.id);
  }
  check(networkPolicy.networks.some(net=>
    net.id===networkPolicy.sourceNetworkId&&net.role==="testnet") &&
    networkPolicy.networks.some(net=>
      canonical(net)===canonical(activation?.network)),
  "an operator cannot relabel another chain as this ceremony family");

  exact(activation,["schema","setupId","familyId","familyTag",
    "network","revision","generationId","signature"],"activation");
  exact(activation.network,["id","genesisHash","role"],"network");
  const {signature:activationSignature,...activationBody}=activation;
  const {generationId,...unsignedActivation}=activationBody;
  const chain=activation.network.id.match(/^eip155:([1-9][0-9]*)$/u)?.[1];
  check(activation.schema==="stealthos-family-network-activation-v1" &&
    chain && Number.isSafeInteger(Number(chain)) && String(Number(chain))===chain &&
    activation.setupId===setup.setupId &&
    activation.familyId===setup.family.id &&
    activation.familyTag===setup.family.tag &&
    ["mainnet","testnet"].includes(activation.network.role) &&
    WORD.test(activation.network.genesisHash??"") &&
    BigInt(activation.network.genesisHash)!==0n &&
    activation.network.genesisHash===activation.network.genesisHash.toLowerCase() &&
    Number.isSafeInteger(activation.revision) &&
    activation.revision>=0 && activation.revision<2**32 &&
    activation.generationId===digest(unsignedActivation) &&
    activation.generationId===pins.generationId &&
    activation.network.id===pins.networkId &&
    activation.network.genesisHash===pins.genesisHash,
  "network activation differs from immutable SDK network pins");
  signCheck(keccak256(toUtf8Bytes(
    "STEALTHOS_VANTA_FAMILY_ACTIVATION_V1:"+canonical(activationBody))),
    activationSignature,setup.family.activationAuthority,"activation");

  exact(lock,["schema","setupId","generationId","familyId","familyTag",
    "network","contracts","relayerConfigSha256","lockId","signature"],
  "deployment lock");
  const {signature:lockSignature,...lockBody}=lock;
  const {lockId,...unsignedLock}=lockBody;
  check(lock.schema==="stealthos-family-deployment-lock-v1" &&
    lock.setupId===setup.setupId &&
    lock.generationId===activation.generationId &&
    lock.familyId===setup.family.id && lock.familyTag===setup.family.tag &&
    canonical(lock.network)===canonical(activation.network) &&
    lock.lockId===digest(unsignedLock) && lock.lockId===pins.lockId &&
    lock.relayerConfigSha256===pins.relayerConfigSha256 &&
    nonzeroSha(lock.relayerConfigSha256) &&
    Array.isArray(lock.contracts) && lock.contracts.length>=4,
  "deployment differs from immutable SDK contract and relayer pins");
  const kinds=new Set(),roles=new Set(),addresses=new Set();
  let previous="";
  for(const item of lock.contracts){
    exact(item,["kind","name","address","codehash"],"contract");
    check(["pool","registry","bootstrap","verifier"].includes(item.kind) &&
      NAME.test(item.name) && !item.name.includes("research") &&
      WORD.test(item.codehash) && BigInt(item.codehash)!==0n &&
      getAddress(item.address)===item.address &&
      item.address!=="0x0000000000000000000000000000000000000000",
    "invalid contract identity");
    const key=item.kind+":"+item.name;
    check(key.localeCompare(previous,"en")>0 && !roles.has(key) &&
      !addresses.has(item.address),
      "duplicate/unordered contract graph");
    previous=key;kinds.add(item.kind);roles.add(key);addresses.add(item.address);
  }
  check(["pool","registry","bootstrap","verifier"].every(k=>kinds.has(k)),
    "incomplete new network graph");
  signCheck(keccak256(toUtf8Bytes(
    "STEALTHOS_VANTA_FAMILY_DEPLOYMENT_V1:"+canonical(lockBody))),
    lockSignature,setup.family.activationAuthority,"deployment");
  return Object.freeze({setupId:setup.setupId,generationId:lock.generationId,
    lockId:lock.lockId,networkId:activation.network.id});
}

/** The chain and immutable on-chain bindings must match before any SDK use. */
export async function assertPinnedFamilyEvmRuntime({provider,setup,activation,
  lock,pins,networkPolicy}){
  return verifyRuntime({provider,setup,activation,lock,pins,networkPolicy},false);
}
async function verifyRuntime({provider,setup,activation,lock,pins,networkPolicy},exitOnly,selection,observation){
  const result=assertPinnedFamilyEvmManifest({setup,activation,lock,pins,
    networkPolicy});
  check(provider?.getNetwork && provider?.getBlock && provider?.getCode &&
    provider?.call,"RPC provider required");
  const chainId=BigInt(pins.networkId.split(":")[1]);
  const [network,genesis,finalized]=observation||await Promise.all([
    provider.getNetwork(),provider.getBlock(0),getConfirmedBlock(provider)]);
  check(network.chainId===chainId &&
    genesis?.hash?.toLowerCase()===pins.genesisHash &&
    finalized?.hash && Number.isSafeInteger(finalized.number) &&
    finalized.number>=1,"wrong network/genesis or unavailable finality");
  const items=selection||lock.contracts;
  const inspect=async item=>{
    const code=await provider.getCode(item.address,finalized.number);
    check(code && code!=="0x" &&
      keccak256(code).toLowerCase()===item.codehash,
    "finalized "+item.kind+":"+item.name+" bytecode differs");
    if(item.kind==="verifier")return;
    const bindings=[
      ["releaseSetupId()",lock.setupId],
      ["releaseGenerationId()",lock.generationId],
      ["releaseFamilyTag()",lock.familyTag],
      ["releaseChainId()",chainId]];
    if(item.kind==="bootstrap")bindings.push(
      ["relayerConfigSha256()",BigInt("0x"+pins.relayerConfigSha256)],
      ...(!exitOnly?[["assertGraph()",1n]]:[]));
    await Promise.all(bindings.map(async([method,expected])=>{
      const data=keccak256(toUtf8Bytes(method)).slice(0,10);
      const returned=await provider.call({to:item.address,data,
        blockTag:finalized.number});
      check(WORD.test(returned??"") &&
        BigInt(returned)===BigInt(expected),
      "finalized "+item.kind+":"+item.name+" "+method+" differs");
    }));
  };
  for(let offset=0;offset<items.length;offset+=8)await Promise.all(items.slice(offset,offset+8).map(inspect));
  check((await provider.getBlock(finalized.number))?.hash?.toLowerCase()===finalized.hash.toLowerCase(),
    "canonical confirmation anchor changed during release verification");
  return Object.freeze({...result,settlement:finalized.settlement,finalizedBlockHash:finalized.hash,
    finalizedBlockNumber:finalized.number});
}

/** This is the only SDK entrypoint permitted to start a family deployment.
 * It cannot accept an RPC-supplied generation, old pool list, or old seed.
 * Until a reviewed SDK bundle embeds an immutable release this fails closed.
 */
export function getCompiledFamilyEvmRelease(releaseContext){
  if(releaseContext!==undefined)return familyReleaseContextRecord(releaseContext).release;
  if(compiledRelease)return compiledRelease;
  check(typeof COMPILED_FAMILY_RELEASE_JSON==="string" &&
    SHA.test(COMPILED_FAMILY_RELEASE_SHA256??"") &&
    COMPILED_FAMILY_HISTORY_JSON===null &&
    sha256(toUtf8Bytes(COMPILED_FAMILY_RELEASE_JSON)).toLowerCase()===
      "0x"+COMPILED_FAMILY_RELEASE_SHA256,
  "no independently pinned family SDK release is built in");
  const release=JSON.parse(COMPILED_FAMILY_RELEASE_JSON);
  const v2=release?.schema==="stealthos-family-sdk-release-v2";
  check(v2 &&
    Object.keys(release).sort().join(",")===
      ["schema","setup","activation","lock","pins",
        "networkPolicy","proving"].sort().join(","),
  "compiled SDK release has unexpected fields or older-generation access");
  assertPinnedFamilyEvmManifest(release);
  validateVantaFamilyProofConfiguration(release.proving,release);
  return compiledRelease=freezeFamilyCatalogValue(release);
}
/** Local signed pins only; this does not claim a live chain check. */
export function getCompiledFamilyWalletContext(releaseContext){
 const {pins}=getCompiledFamilyEvmRelease(releaseContext);
 return Object.freeze({networkId:pins.networkId,setupId:pins.setupId,generationId:pins.generationId,lockId:pins.lockId});
}
const operationChecks=new WeakMap();
/** Fresh selected-pool checks. Mutable fees, balances and nonces are read by
 * operation hosts and never replaced by a cached deployment result. */
async function verifyOperationRuntime(provider,pool,releaseContext,roles,exitOnly){
 const release=getCompiledFamilyEvmRelease(releaseContext),address=getAddress(pool),
  row=release.lock.contracts.find(c=>c.kind==='pool'&&getAddress(c.address)===address);
 check(row&&/-pool$/u.test(row.name),'operation pool is absent from the signed release');
 check(Array.isArray(roles)&&roles.length<=32&&roles.every(v=>typeof v==='string'),'invalid operation dependencies');
 const names=new Set([row.name,row.name.replace(/-pool$/u,'-bootstrap'),'partner-registry',...roles]),
  selection=release.lock.contracts.filter(c=>names.has(c.name));
 check(selection.length===names.size,'operation dependency is absent from the signed release');
 const actual=canonicalFamilyProvider(provider),observation=await Promise.all([actual.getNetwork(),actual.getBlock(0),getConfirmedBlock(actual)]),[network,genesis,block]=observation;
 check(network.chainId===BigInt(release.pins.networkId.split(':')[1])&&genesis?.hash?.toLowerCase()===release.pins.genesisHash&&block?.hash,'operation network/genesis changed');
 const key=release.pins.networkId+':'+release.pins.generationId+':'+release.pins.lockId+':'+exitOnly+':'+[...names].sort().join(',')+':'+block.hash.toLowerCase();
 let pending=operationChecks.get(actual);if(!pending){pending=new Map();operationChecks.set(actual,pending);}
 // Reuse only checks for this exact freshly observed canonical block hash.
 // No localStorage boolean or arbitrary TTL can authorize a payment.
 if(pending.has(key))return pending.get(key);
 const work=verifyRuntime({provider:actual,...release},exitOnly,selection,observation);
 if(pending.size>=64)pending.delete(pending.keys().next().value);
 pending.set(key,work);try{return await work;}catch(error){if(pending.get(key)===work)pending.delete(key);throw error;}
}
export const verifyCompiledFamilyOperationRuntime=(provider,pool,releaseContext,roles=[])=>verifyOperationRuntime(provider,pool,releaseContext,roles,isFamilyWithdrawalOnlyContext(releaseContext));
export const verifyCompiledFamilyRecoveryRuntime=(provider,pool,releaseContext,roles=[])=>verifyOperationRuntime(provider,pool,releaseContext,roles,true);
export async function verifyCompiledFamilyEvmRuntime(provider,releaseContext){
  const release=getCompiledFamilyEvmRelease(releaseContext);
  return verifyRuntime({provider,...release},isFamilyWithdrawalOnlyContext(releaseContext));
}
/** Exit-only verification retains every immutable code/key/network binding.
 * It does not require a retired registry to keep its former pool active. */
export async function verifyCompiledFamilyExitRuntime(provider,releaseContext){
  const release=getCompiledFamilyEvmRelease(releaseContext);
  return verifyRuntime({provider,...release},true);
}

function catalog(){
 if(compiledCatalog)return compiledCatalog;
 const current=getCompiledFamilyEvmRelease();
 const records=COMPILED_FAMILY_CATALOG_JSON===null&&COMPILED_FAMILY_CATALOG_SHA256===null?[]:
  validateFamilyKzgCatalog({json:COMPILED_FAMILY_CATALOG_JSON,sha256:COMPILED_FAMILY_CATALOG_SHA256,current,
   validateRelease:release=>{assertPinnedFamilyEvmManifest(release);validateVantaFamilyProofConfiguration(release.proving,release);},
   validateResources:validateVantaFamilyProofResources});
 compiledCatalog=Object.freeze([{mode:'active',release:current,inventory:null},...records].map(record=>{
  freezeFamilyCatalogValue(record);
  const ticket=Object.freeze({networkId:record.release.pins.networkId,generationId:record.release.pins.generationId,
   mode:record.mode,setupId:record.release.pins.setupId});releaseContexts.set(ticket,record);return ticket;
 }));return compiledCatalog;
}
/** Only identifiers are accepted. RPCs and applications cannot supply releases. */
export function getCompiledFamilyPoolGenerations(){return catalog();}
export function selectCompiledFamilyGeneration({networkId,generationId}={}){
 const matches=catalog().filter(c=>c.networkId===networkId&&(generationId===undefined?c.mode==='active':c.generationId===generationId));
 check(matches.length===1,'network or generation is not in the compiled KZG catalog');return matches[0];
}
export function familyReleaseContextRecord(context){
 const record=releaseContexts.get(context);check(record,'a compiled generation capability is required');return record;
}
export function isFamilyWithdrawalOnlyContext(context){return context!==undefined&&familyReleaseContextRecord(context).mode==='withdraw-only';}

