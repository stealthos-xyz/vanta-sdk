/** Authenticated note-opening resources and per-pool host policy. The enclosing
 * V2 inventory digest is part of the signed compiled release. No defaults are
 * supplied for missing deployments, fee rates, relayers or schedule policy. */
import {validateFamilyRoutedResources} from './family-routed-resources.mjs';
const required=(ok,message)=>{if(!ok)throw Error("Family funding resources: "+message);};
const exact=(v,names)=>required(v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.slice().sort().join(),"unexpected fields");
const ADDRESS=/^0x[0-9a-f]{40}$/u,WORD=/^0x[0-9a-f]{64}$/u,SHA=/^[0-9a-f]{64}$/u;
export const isFamilyAssetSelection=value=>['native','token'].includes(value)||typeof value==='string'&&ADDRESS.test(value)&&BigInt(value)>0n;
const leaf=v=>{exact(v,["path","sha256","bytes"]);required(typeof v.path==="string"&&
  /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/u.test(v.path)&&!v.path.split("/").some(s=>s==="."||s==="..")&&
  SHA.test(v.sha256)&&BigInt("0x"+v.sha256)>0n&&Number.isSafeInteger(v.bytes)&&v.bytes>0&&v.bytes<=128*1024*1024,"invalid resource pin");return Object.freeze({...v});};
export function validateVantaFamilyFundingResources(raw,release){
  exact(raw,["schema","publicCache","pools",...(raw.routes===undefined?[]:['routes'])]);required(raw.schema==="vanta-family-kzg-funding-resources-v1","unsupported funding schema");
  exact(raw.publicCache,["runtime","corpus","metadata"]);exact(raw.publicCache.runtime,["glue","wasm","rawWasm","build"]);
  const publicCache=Object.freeze({runtime:Object.freeze(Object.fromEntries(["glue","wasm","rawWasm","build"].map(n=>[n,leaf(raw.publicCache.runtime[n])]))),
    corpus:leaf(raw.publicCache.corpus),metadata:leaf(raw.publicCache.metadata)});
  required(publicCache.runtime.glue.path.endsWith(".js")&&publicCache.runtime.wasm.path.endsWith(".wasm")&&
    publicCache.runtime.rawWasm.path.endsWith(".wasm")&&publicCache.runtime.build.path.endsWith(".json")&&publicCache.runtime.build.bytes<=2*1024*1024&&
    publicCache.corpus.bytes===12582912&&publicCache.metadata.bytes<=2*1024*1024,"wrong note-opening corpus or runtime layout");
  const locks=release.lock.contracts.filter(v=>v.kind==="pool");
  required(Array.isArray(raw.pools)&&raw.pools.length===locks.length&&raw.pools.length>0&&raw.pools.length<=8,"one host configuration per signed pool is required");
  const pools=raw.pools.map(p=>{
    exact(p,["pool","asset","poolCodehash","deploymentBlock","assetSymbol","assetDecimals","protocolBps","relayerAddress","hostPolicy"]);
    required([p.pool,p.asset,p.relayerAddress].every(v=>ADDRESS.test(v))&&BigInt(p.pool)>0n&&BigInt(p.relayerAddress)>0n&&
      WORD.test(p.poolCodehash)&&BigInt(p.poolCodehash)>0n&&locks.some(v=>v.address.toLowerCase()===p.pool&&v.codehash.toLowerCase()===p.poolCodehash)&&
      Number.isSafeInteger(p.deploymentBlock)&&p.deploymentBlock>0&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/u.test(p.assetSymbol)&&
      Number.isSafeInteger(p.assetDecimals)&&p.assetDecimals>=0&&p.assetDecimals<=36&&Number.isInteger(p.protocolBps)&&p.protocolBps>=0&&p.protocolBps<=10000,
      "invalid signed pool identity or display/fee pins");
    exact(p.hostPolicy,["windowEpochs","minimumDelayEpochs","maximumAuthorizationAgeEpochs","reviewTtlSeconds"]);
    const policy=p.hostPolicy;required(Object.values(policy).every(Number.isSafeInteger)&&policy.windowEpochs>0&&policy.windowEpochs<=360&&
      policy.maximumAuthorizationAgeEpochs>=0&&policy.minimumDelayEpochs>policy.maximumAuthorizationAgeEpochs&&
      policy.minimumDelayEpochs<policy.windowEpochs&&policy.reviewTtlSeconds>0&&policy.reviewTtlSeconds<=900,"invalid reviewed schedule policy");
    return Object.freeze({...p,hostPolicy:Object.freeze({...policy})});
  });
  required(new Set(pools.map(p=>p.pool)).size===pools.length&&new Set(pools.map(p=>p.asset)).size===pools.length,"duplicate funding pool or asset");
  return Object.freeze({schema:raw.schema,publicCache,pools:Object.freeze(pools),...(raw.routes===undefined?{}:{routes:validateFamilyRoutedResources(raw.routes,release,pools)})});
}
export function selectVantaFamilyFundingResources(release,inventory,asset="native"){
  required(isFamilyAssetSelection(asset),"unsupported pool asset selection");
  const funding=validateVantaFamilyFundingResources(inventory.funding,release);
  const canonical=release.lock.contracts.find(c=>c.name==='canonical-token')?.address?.toLowerCase();
  const matches=funding.pools.filter(p=>asset==='native'?BigInt(p.asset)===0n:asset==='token'?
    canonical?p.asset===canonical:BigInt(p.asset)!==0n:p.asset===asset);
  required(matches.length===1,"pool selection is ambiguous");const deployment=matches[0];
  return Object.freeze({chainId:Number(release.pins.networkId.split(":")[1]),familyTag:release.setup.family.tag,
    genesisHash:release.pins.genesisHash,generationId:release.pins.generationId,
    deployment:Object.freeze({...deployment,setupId:release.pins.setupId}),publicCache:funding.publicCache,
    profiles:Object.freeze(Object.fromEntries(["normal8","normal32","exit8","exit32","aggregate"].map(n=>[n,inventory.profiles[n]]))),
    driver:release.proving.driver,candidateOnly:true,safeForFunds:false});
}

/** The immutable final lookup metadata retains its setup source domain.
 * Network activation is independently pinned by the signed release; copying
 * this shared corpus to another qualification network never rewrites it. */
export function validateVantaFamilyNoteOpeningMetadata(raw,corpus){
  required(raw&&raw.schema==="vanta-fresh-public-openings-v1"&&raw.chainId===6281971&&
    raw.n===65536&&raw.reservedDummySlots===32&&raw.bytes===12582912&&raw.bytes===corpus.bytes&&
    typeof raw.sha256==="string"&&raw.sha256.replace(/^sha256:/u,"").replace(/^0x/u,"")===corpus.sha256,
    "note-opening metadata differs from the immutable lookup corpus");
  required(WORD.test(raw.lagRoot)&&WORD.test(raw.tauG1)&&/^0x[0-9a-f]{128}$/u.test(raw.hG2),
    "invalid note-opening setup commitments");
  return Object.freeze({...raw});
}

export function validateVantaFamilyPublicCacheBuild(raw,pins,metadata,chainId){
  const semantic={schema:"vanta-family-public-cache-build-v1",chainId,
    corpusSha256:"sha256:"+pins.corpus.sha256,lagRoot:metadata.lagRoot,tauG1:metadata.tauG1,hG2:metadata.hG2};
  required(raw&&Object.entries(semantic).every(([k,v])=>raw[k]===v)&&
    raw.glueSha256===pins.runtime.glue.sha256&&raw.wasmSha256===pins.runtime.wasm.sha256&&
    raw.rawWasmSha256===pins.runtime.rawWasm.sha256&&raw.metadataSha256===pins.metadata.sha256&&raw.corpusBytes===pins.corpus.bytes,
    "cache build differs from its signed runtime, corpus or activation");
  for(const [name,pin]of [["raw.wasm",pins.runtime.rawWasm],["stealthos_base_decider.js",pins.runtime.glue],["stealthos_base_decider_bg.wasm",pins.runtime.wasm]])
    required(raw.outputs?.[name]?.sha256===pin.sha256&&raw.outputs[name].bytes===pin.bytes,"cache build output identity differs");
  return Object.freeze(semantic);
}
