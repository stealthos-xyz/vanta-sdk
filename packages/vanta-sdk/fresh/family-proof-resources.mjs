import {validateVantaFamilyFundingResources} from "./family-funding-resources.mjs";
import {validateVantaPartnerPolicyKzgProfile} from "./partner-policy-kzg.mjs";
import {familyReleaseContextRecord} from './family-network.mjs';
/** Immutable funded proof inventory. Query/matrix bytes are streamed against
 * digest-pinned manifests; no whole proving-key resource exists in this API. */
import {sha256} from "ethers";
import {validateVantaFamilyBound4Descriptor} from "./family-proof-driver.mjs";
import {COMPILED_FAMILY_PROOF_RESOURCES_JSON,
  COMPILED_FAMILY_PROOF_RESOURCES_SHA256} from "./generated-family-proof-resources.mjs";
import {FAMILY_ROLE_IDS_V2,FAMILY_PROOF_PROFILES_V2,FAMILY_STANDARD_STREAM_PROFILES_V2,
  FAMILY_ENHANCED_COMPONENT_PUBLIC_INPUTS_V2}
  from "./family-role-contract.mjs";

const SHA=/^[0-9a-f]{64}$/u,WORD=/^0x[0-9a-f]{64}$/u;
const PATH=/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/u;
const PROFILES=Object.keys(FAMILY_PROOF_PROFILES_V2);
const SECTIONS=["H","L","A","B_G1","B_G2"];
const CIRCUITS=FAMILY_PROOF_PROFILES_V2;
const CIRCUIT_IDS=FAMILY_ROLE_IDS_V2;
const ENHANCED_COMPONENTS=Object.keys(FAMILY_ENHANCED_COMPONENT_PUBLIC_INPUTS_V2);
const canonical=value=>Array.isArray(value)?"["+value.map(canonical).join(",")+"]":
  value&&typeof value==="object"?"{"+Object.keys(value).sort().map(key=>
    JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}":JSON.stringify(value);
const required=(condition,message)=>{if(!condition)throw Error("Family proof resources: "+message);};
const exact=(value,fields,label)=>required(value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).sort().join()===fields.slice().sort().join(),"invalid "+label);
const nonzero=(value,pattern)=>typeof value==="string"&&pattern.test(value)&&
  BigInt(value.startsWith("0x")?value:"0x"+value)!==0n;
const leaf=(raw,label)=>{
  exact(raw,["path","sha256","bytes"],label);
  required(typeof raw.path==="string"&&PATH.test(raw.path)&&
    !raw.path.split("/").some(part=>part==="."||part==="..")&&
    nonzero(raw.sha256,SHA)&&Number.isSafeInteger(raw.bytes)&&raw.bytes>0&&
    raw.bytes<=128*1024*1024,"invalid "+label+" pin");
  return Object.freeze({...raw});
};

export function validateVantaFamilyProofConfiguration(raw,release){
  exact(raw,["driver","resourcesSha256","circuits"],"proving configuration");
  const driver=validateVantaFamilyBound4Descriptor(raw.driver);
  required(driver.schema==="stealthos-family-bound4-driver-v2"&&
    driver.partnerPolicyScheme==="kzg-caulk-plus-cclink-v1","fee relations require the KZG v2 driver");
  required(nonzero(raw.resourcesSha256,SHA)&&
    driver.familyId===release?.pins?.familyId&&driver.networkId===release?.pins?.networkId&&
    driver.familyTag===release?.setup?.family?.tag&&
    driver.networkId===release?.activation?.network?.id,
  "driver differs from the signed network family");
  required(Array.isArray(raw.circuits)&&raw.circuits.length===CIRCUIT_IDS.length,
    "full family circuit inventory required");
  const circuits=raw.circuits.map((row,index)=>{
    exact(row,["id","r1csSha256","sourceSha256","familyTag"],"sealed circuit");
    required(row.id===CIRCUIT_IDS[index]&&row.familyTag===driver.familyTag&&
      nonzero(row.r1csSha256,SHA)&&nonzero(row.sourceSha256,SHA),"invalid or unordered sealed circuit pins");
    return Object.freeze({...row});
  });
  required(sha256(new TextEncoder().encode(canonical(circuits)))===
    "0x"+release?.setup?.circuitInventorySha256,"circuit pins differ from the signed setup");
  return Object.freeze({driver,resourcesSha256:raw.resourcesSha256,circuits:Object.freeze(circuits)});
}

/** Two separately keyed ordinary Groth16 components, never M2/STREAM_BOUND4
 * fee profiles. Their contract bytecode must be in the signed family lock. */
export function validateVantaFamilyEnhancedComponentResources(raw,configuration,release){
  exact(raw,ENHANCED_COMPONENTS,"separate enhanced proof components");
  return Object.freeze(Object.fromEntries(ENHANCED_COMPONENTS.map(name=>{
    const source=raw[name];
    exact(source,["r1csSha256","publicInputs","provingKey","verificationKey","runtime","verifier"],name);
    const pinned=configuration.circuits.find(item=>item.id===name);
    required(source.r1csSha256===pinned?.r1csSha256&&
      source.publicInputs===FAMILY_ENHANCED_COMPONENT_PUBLIC_INPUTS_V2[name],
    "enhanced proving key is not the signed R1CS/public layout: "+name);
    exact(source.runtime,["glue","wasm"],name+" runtime");
    const runtime=Object.freeze({glue:leaf(source.runtime.glue,name+" glue"),
      wasm:leaf(source.runtime.wasm,name+" WASM")});
    required(runtime.glue.path.endsWith(".js")&&runtime.wasm.path.endsWith(".wasm"),
      "enhanced proof runtime must pin ESM/WASM bytes");
    exact(source.verifier,["name","address","codehash"],name+" Solidity verifier");
    required(source.verifier.name===name&&/^0x[0-9a-fA-F]{40}$/u.test(source.verifier.address)&&
      /^0x[0-9a-fA-F]{64}$/u.test(source.verifier.codehash)&&
      release.lock.contracts.some(item=>item.kind==="verifier"&&item.name===name&&
        item.address.toLowerCase()===source.verifier.address.toLowerCase()&&
        item.codehash.toLowerCase()===source.verifier.codehash.toLowerCase()),
    "enhanced verifier address and bytecode must match the signed deployment lock: "+name);
    return [name,Object.freeze({...source,runtime,
      provingKey:leaf(source.provingKey,name+" proving key"),
      verificationKey:leaf(source.verificationKey,name+" verification key"),
      verifier:Object.freeze({...source.verifier})})];
  })));
}

export function validateVantaFamilyProofResources(raw,release){
  required(release?.schema==="stealthos-family-sdk-release-v2",
    "funded proofs require a v2 compiled family descriptor");
  const configuration=validateVantaFamilyProofConfiguration(release.proving,release);
  exact(raw,["schema","familyId","familyTag","networkId","setupId","generationId",
    "sourceCommit","profiles","partnerPolicyKzg","credentials","enhancedComponents","funding"],"inventory");
  required(raw.schema==="stealthos-family-bound4-resources-v2"&&
    raw.familyId===configuration.driver.familyId&&raw.familyTag===configuration.driver.familyTag&&
    raw.networkId===configuration.driver.networkId&&raw.setupId===release.pins.setupId&&
    raw.generationId===release.pins.generationId&&nonzero(raw.setupId,WORD)&&
    nonzero(raw.generationId,WORD)&&/^[0-9a-f]{40}$/u.test(raw.sourceCommit??""),
  "inventory differs from the signed generation");
  const partnerPolicyKzg=validateVantaPartnerPolicyKzgProfile(raw.partnerPolicyKzg);
  required(partnerPolicyKzg.chainId===Number(configuration.driver.networkId.slice(7))&&partnerPolicyKzg.setupId===raw.setupId&&
    partnerPolicyKzg.generationId===raw.generationId&&partnerPolicyKzg.familyTag===raw.familyTag&&
    partnerPolicyKzg.genesisHash===release.pins.genesisHash,"policy table differs from the signed generation");
  for(const pin of Object.values(partnerPolicyKzg.verifiers))
    required(release.lock.contracts.some(item=>item.kind==="verifier"&&
      item.address.toLowerCase()===pin.address.toLowerCase()&&item.codehash.toLowerCase()===pin.codehash),
    "policy lookup verifier is not in the signed deployment lock");
  exact(raw.credentials,["handle-register","partner-owner"],"credentials");
  const credentials=Object.freeze(Object.fromEntries(["handle-register","partner-owner"].map(name=>{
    const source=raw.credentials[name];
    exact(source,["witnessWasm","zkey","verificationKey"],name+" credential");
    return [name,Object.freeze(Object.fromEntries(Object.entries(source).map(([kind,pin])=>
      [kind,leaf(pin,name+" "+kind)])))];
  })));
  const enhancedComponents=validateVantaFamilyEnhancedComponentResources(
    raw.enhancedComponents,configuration,release);
  exact(raw.profiles,PROFILES,"profiles");
  const profiles={};
  for(const name of PROFILES){
    const source=raw.profiles[name],standard=FAMILY_STANDARD_STREAM_PROFILES_V2.includes(name),
      fee=name!=="aggregate"&&standard;
    const fields=standard?["runtime","r1csSha256","provingKeySha256","keyManifest","fixedKey",
      "matrixManifest","matrix","queries",...(fee?["policyLookupKey"]:[])]:["runtime","r1csSha256","m2Manifest","m2Key",
      "matrixManifest","matrix","publicMaterial","setupLockSha256"];
    exact(source,fields,name);
    exact(source.runtime,["glue","wasm"],name+" runtime");
    required(nonzero(source.r1csSha256,SHA)&&configuration.circuits.find(row=>row.id===CIRCUITS[name])?.r1csSha256===source.r1csSha256,
      "R1CS pin differs from the signed "+name+" circuit");
    const profile={runtime:Object.freeze({glue:leaf(source.runtime.glue,name+" glue"),
      wasm:leaf(source.runtime.wasm,name+" WASM")}),r1csSha256:source.r1csSha256};
    required(profile.runtime.glue.path.endsWith(".js")&&profile.runtime.wasm.path.endsWith(".wasm"),
      "runtime filenames must preserve ESM/WASM types");
    for(const key of standard?["keyManifest","fixedKey","matrixManifest","matrix"]:
      ["m2Manifest","m2Key","matrixManifest","matrix","publicMaterial"])
      profile[key]=leaf(source[key],name+" "+key);
    if(standard){
      required(nonzero(source.provingKeySha256,SHA),"missing "+name+" key derivation pin");
      profile.provingKeySha256=source.provingKeySha256;
      if(fee){
        profile.policyLookupKey=leaf(source.policyLookupKey,name+" policy lookup key");
        const approved=partnerPolicyKzg.lookupKeys[name];
        required(approved.path===profile.policyLookupKey.path&&approved.bytes===profile.policyLookupKey.bytes&&
          approved.sha256==="0x"+profile.policyLookupKey.sha256,"policy lookup key differs from its relation pin");
      }
      exact(source.queries,SECTIONS,name+" query sections");
      profile.queries=Object.freeze(Object.fromEntries(SECTIONS.map(section=>
        [section,leaf(source.queries[section],name+" query "+section)])));
    }else{
      required(/^sha256:[0-9a-f]{64}$/u.test(source.setupLockSha256??""),"invalid setup lock");
      profile.setupLockSha256=source.setupLockSha256;
    }
    profiles[name]=Object.freeze(profile);
  }
  for(const name of ["aggregate","combined","enhanced"]){
    for(const kind of ["glue","wasm"]){
      const actual=profiles[name].runtime[kind],shared=profiles.normal8.runtime[kind];
      required(actual.sha256===shared.sha256&&actual.bytes===shared.bytes,
        "standard proof roles must reuse the pinned normal8 engine");
    }
  }
  const funding=validateVantaFamilyFundingResources(raw.funding,release);
  // Aliasing a runtime is allowed only for identical pinned bytes. A path may
  // never silently identify different resources across relations.
  const paths=new Map();
  for(const item of familyProofResourceLeaves({profiles,partnerPolicyKzg,credentials,enhancedComponents,funding})){
    const old=paths.get(item.path);
    required(!old||(old.sha256===item.sha256&&old.bytes===item.bytes),"conflicting artifact paths");
    paths.set(item.path,item);
  }
  return Object.freeze({...raw,partnerPolicyKzg,credentials,enhancedComponents,funding,profiles:Object.freeze(profiles)});
}
export function familyProofResourceLeaves(inventory){
  const leaves=[];
  const visit=value=>{
    if(value&&typeof value==="object"){
      if(Object.hasOwn(value,"path")){leaves.push({...value,sha256:value.sha256.replace(/^0x/u,"")});return;}
      for(const item of Object.values(value))visit(item);
    }
  };
  visit(inventory.profiles);visit(inventory.partnerPolicyKzg);visit(inventory.credentials);
  visit(inventory.enhancedComponents);visit(inventory.funding);
  return leaves;
}
export function getCompiledVantaFamilyProofResources(release,releaseContext){
  if(releaseContext!==undefined){
    const record=familyReleaseContextRecord(releaseContext);
    required(record.release.pins.networkId===release?.pins?.networkId&&record.release.pins.generationId===release?.pins?.generationId&&
      record.release.pins.lockId===release?.pins?.lockId,'generation resource capability differs');
    if(record.inventory)return record.inventory;
  }
  required(typeof COMPILED_FAMILY_PROOF_RESOURCES_JSON==="string"&&
    COMPILED_FAMILY_PROOF_RESOURCES_JSON.length<=256*1024&&
    nonzero(COMPILED_FAMILY_PROOF_RESOURCES_SHA256,SHA)&&
    sha256(new TextEncoder().encode(COMPILED_FAMILY_PROOF_RESOURCES_JSON))===
      "0x"+COMPILED_FAMILY_PROOF_RESOURCES_SHA256&&
    release?.proving?.resourcesSha256===COMPILED_FAMILY_PROOF_RESOURCES_SHA256,
  "no matching compiled STREAM_BOUND4 inventory");
  return validateVantaFamilyProofResources(JSON.parse(COMPILED_FAMILY_PROOF_RESOURCES_JSON),release);
}

/** A host chooses only a secure locator. Hashes, relation and driver are
 * supplied by the reviewed SDK, never by an RPC response or URL manifest. */
export function createVantaFamilyProofArtifactReader({artifactBaseUrl,fetcher=fetch,signal}={}){
  const location=globalThis.location;
  let base;
  try{base=new URL(artifactBaseUrl,location?.href);}catch{throw Error("Invalid family artifact origin.");}
  required(location&&!base.username&&!base.password&&!base.search&&!base.hash&&
    (base.protocol==="https:"||(base.protocol==="http:"&&["localhost","127.0.0.1"].includes(base.hostname))),
  "trusted local proof runtime requires a secure artifact locator");
  if(!base.pathname.endsWith("/"))base.pathname+="/";
  const url=pin=>{
    leaf(pin,"requested artifact");
    const result=new URL(pin.path,base);
    required(result.origin===base.origin&&result.pathname.startsWith(base.pathname),"artifact escaped origin");
    return result.href;
  };
  const read=async(pin,offset,length,range)=>{
    signal?.throwIfAborted();
    required(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>0&&
      offset+length<=pin.bytes&&(!range||length<=2*1024*1024),"invalid bounded read");
    const response=await fetcher(url(pin),{signal,credentials:"omit",redirect:"error",
      ...(range?{headers:{Range:`bytes=${offset}-${offset+length-1}`}}:{})});
    required(!response.redirected&&response.type!=="opaque"&&response.body&&
      response.status===(range?206:200),"pinned artifact unavailable");
    if(range)required(response.headers.get("Content-Range")===
      `bytes ${offset}-${offset+length-1}/${pin.bytes}`,"range response differs");
    const declared=response.headers.get("content-length");
    required(declared===null||(/^\d+$/u.test(declared)&&Number(declared)===length),"response size differs");
    const result=new Uint8Array(length),reader=response.body.getReader();
    let received=0;
    try{
      for(;;){
        signal?.throwIfAborted();
        const next=await reader.read();if(next.done)break;
        required(next.value instanceof Uint8Array&&received+next.value.length<=length,"oversized artifact response");
        result.set(next.value,received);received+=next.value.length;
      }
      required(received===length,"truncated artifact response");
      if(!range)required(sha256(result)==="0x"+pin.sha256,"artifact SHA-256 differs");
      signal?.throwIfAborted();
      return result;
    }catch(error){result.fill(0);try{await reader.cancel();}catch{}throw error;}
    finally{reader.releaseLock();}
  };
  return Object.freeze({url,
    bytes:pin=>read(pin,0,pin.bytes,false),
    range:(pin,offset,length)=>read(pin,offset,length,true)});
}

/** Link streamed manifests to the inventory already authenticated by the SDK.
 * The release compiler additionally hashes every file and manifest chunk. */
export function assertVantaFamilyStreamManifestPins({name,profile,key,matrix,driver}){
  validateVantaFamilyBound4Descriptor(driver);
  const chainId=Number(driver.networkId.slice(7));
  const standard=FAMILY_STANDARD_STREAM_PROFILES_V2.includes(name);
  if(standard){
    const relation=name==="aggregate"?"payout-aggregate":name==="enhanced"?"enhanced-fee-partner":"combined-fee-partner";
    required(key?.selected_proof_path==="STREAM_BOUND4"&&matrix?.selected_proof_path==="STREAM_BOUND4"&&
      key.relation===relation&&matrix.relation===relation&&key.chain_id===chainId&&matrix.chain_id===chainId&&
      key.family_tag===driver.familyTag&&matrix.family_tag===driver.familyTag&&
      key.r1cs_sha256===profile.r1csSha256&&matrix.r1cs_sha256===profile.r1csSha256&&
      key.pk_sha256===profile.provingKeySha256&&key.fixed_sha256===profile.fixedKey.sha256&&
      key.fixed_bytes===profile.fixedKey.bytes&&matrix.file_sha256===profile.matrix.sha256&&
      matrix.file_bytes===profile.matrix.bytes,"standard stream does not match its compiled pins");
    if(name==="combined"||name==="enhanced")required(
      driver.schema==="stealthos-family-bound4-driver-v2"&&
      driver.partnerPolicyScheme==="kzg-caulk-plus-cclink-v1"&&
      key.commitment_scheme==="ccgroth16-policy-v1"&&key.committed_witnesses===1&&
      profile.policyLookupKey?.bytes>0,
      "KZG fee relation must commit one private policy leaf and pin its lookup verifier");
    required(Array.isArray(key.sections)&&key.sections.length===SECTIONS.length,
      "incomplete streamed query sections");
    const sibling=(manifestPath,filename)=>{
      required(typeof filename==="string"&&/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(filename),
        "unsafe stream filename");
      return manifestPath.slice(0,manifestPath.lastIndexOf("/")+1)+filename;
    };
    required(sibling(profile.keyManifest.path,key.fixed_file)===profile.fixedKey.path&&
      sibling(profile.matrixManifest.path,matrix.file)===profile.matrix.path,"stream file aliases differ");
    for(let i=0;i<SECTIONS.length;i++){
      const section=key.sections[i],pin=profile.queries[SECTIONS[i]];
      required(section?.id===SECTIONS[i]&&section.bytes===pin.bytes&&
        sibling(profile.keyManifest.path,section.file)===pin.path,"query file alias differs");
    }
  }else{
    required(key?.package_sha256===profile.m2Key.sha256&&key.package_bytes===profile.m2Key.bytes&&
      matrix?.matrix_sha256===profile.matrix.sha256&&matrix.matrix_file_bytes===profile.matrix.bytes&&
      matrix.instance_variables===7,"Gate0 stream does not match its compiled pins");
  }
}

