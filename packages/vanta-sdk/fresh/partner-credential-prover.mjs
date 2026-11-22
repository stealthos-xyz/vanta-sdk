import {getCompiledFamilyEvmRelease} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources,createVantaFamilyProofArtifactReader}
  from "./family-proof-resources.mjs";
import {getFamilyBootstrapCredentialContext} from "./bootstrap-credential-scope.mjs";
/** Ceremony-pinned current-family credential proofs. */
const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FQ=21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const H32=/^0x[0-9a-f]{64}$/iu;
const value=(input,label,nonzero=true)=>{
  if(typeof input!=="string"||!H32.test(input))
    throw Error("Invalid fresh credential "+label+".");
  const n=BigInt(input);
  if(n>=FR||nonzero&&n===0n)
    throw Error("Fresh credential "+label+" exceeds the scalar field.");
  return n;
};
const digestField=(input,label)=>{
  if(typeof input!=="string"||!H32.test(input))
    throw Error("Invalid fresh credential "+label+".");
  return BigInt(input)%FR;
};
function coordinates(proof){
  const words=[proof?.pi_a?.[0],proof?.pi_a?.[1],
    proof?.pi_b?.[0]?.[1],proof?.pi_b?.[0]?.[0],
    proof?.pi_b?.[1]?.[1],proof?.pi_b?.[1]?.[0],
    proof?.pi_c?.[0],proof?.pi_c?.[1]];
  if(words.some(item=>typeof item!=="string"||
      !/^(0|[1-9][0-9]*)$/u.test(item)||BigInt(item)>=FQ))
    throw Error("Fresh credential proof has invalid BN254 coordinates.");
  return Object.freeze(words.map(BigInt));
}
async function executePinnedCredential(input,expected,artifacts,signal){
  try{
    const [wasm,zkey,vkey]=artifacts.map(item=>item.bytes);
    const verificationKey=JSON.parse(new TextDecoder("utf-8",{fatal:true})
      .decode(vkey));
    if(verificationKey?.protocol!=="groth16"||
       Number(verificationKey?.nPublic)!==expected.length)
      throw Error("Fresh credential verification key has another relation.");
    if(signal?.aborted)throw Error("Fresh credential proof cancelled.");
    const snarkjs=await import("snarkjs");
    const {proof,publicSignals}=await snarkjs.groth16.fullProve(input,
      wasm,zkey,undefined,undefined,{singleThread:true});
    if(signal?.aborted)throw Error("Fresh credential proof cancelled.");
    if(!Array.isArray(publicSignals)||publicSignals.length!==expected.length||
       publicSignals.some((item,index)=>
         !/^(0|[1-9][0-9]*)$/u.test(item)||BigInt(item)!==expected[index])||
       !(await snarkjs.groth16.verify(verificationKey,publicSignals,proof)))
      throw Error("Fresh credential proof failed exact public-signal verification.");
    return coordinates(proof);
  }finally{for(const artifact of artifacts)artifact.bytes.fill(0);}
}
/** Same genuine credential prover, with the family relation's seven public inputs.
 * Artifact bytes come only from the signed, compiled family inventory. */
async function proveFamilyCredential(kind,input,expected,options){
  const bootstrap=options?.credentialScope?getFamilyBootstrapCredentialContext(options.credentialScope):null;
  const inventory=bootstrap??getCompiledVantaFamilyProofResources(getCompiledFamilyEvmRelease(options?.releaseContext),options?.releaseContext);
  const reader=createVantaFamilyProofArtifactReader(options),pins=inventory.credentials[kind];
  if(!pins)throw Error("Family credential artifacts are not compiled.");
  const artifacts=await Promise.all(["witnessWasm","zkey","verificationKey"].map(async key=>
    ({bytes:await reader.bytes(pins[key])})));
  return executePinnedCredential(input,expected,artifacts,options.signal);
}
export async function proveFamilyHandleClaim(witness,options){
  const release=options?.credentialScope?getFamilyBootstrapCredentialContext(options.credentialScope):getCompiledFamilyEvmRelease(options?.releaseContext),
    chain=BigInt(release.pins.networkId.slice(7));
  if(BigInt(witness.chainId)!==chain||witness.epoch!==1)
    throw Error("Family handle proof targets another compiled network.");
  const id=value(witness.handleId,"handle ID"),record=value(witness.recordCommitment,"record"),
    owner=value(witness.ownerCommitment,"owner"),nullifier=value(witness.nullifier,"nullifier"),
    hsk=value(witness.hsk,"handle secret"),label=digestField(witness.handleLabelHash,"label"),
    recordHash=digestField(witness.recordHash,"record hash");
  return proveFamilyCredential("handle-register",{handleId:id.toString(),recordCommitment:record.toString(),
    ownerCommitment:owner.toString(),epoch:"1",nullifier:nullifier.toString(),chainId:chain.toString(),
    actionTag:"1",handleLabelHash:label.toString(),recordHash:recordHash.toString(),hsk:hsk.toString()},
    [id,record,owner,1n,nullifier,chain,1n],options);
}
export async function proveFamilyPartnerOwner(witness,options){
  const release=options?.credentialScope?getFamilyBootstrapCredentialContext(options.credentialScope):getCompiledFamilyEvmRelease(options?.releaseContext),
    chain=BigInt(release.pins.networkId.slice(7)),
    family=BigInt(release.setup.family.tag);
  if(BigInt(witness.chainId)!==chain||BigInt(witness.familyTag)!==family)
    throw Error("Family owner proof targets another compiled generation.");
  const names=["handleId","ownerCommitment","authorizationCommitment","actionDigest",
    "authorizationNullifier","hsk","signingAddress","signingSalt"];
  const fields=Object.fromEntries(names.map(name=>[name,value(witness[name],name)]));
  if(fields.signingAddress>=(1n<<160n))throw Error("Family owner signer exceeds 160 bits.");
  const input=Object.fromEntries(names.map(name=>[name==="signingAddress"?"signerAddress":
    name==="signingSalt"?"signerSalt":name,fields[name].toString()]));
  input.familyTag=family.toString();input.chainId=chain.toString();
  return proveFamilyCredential("partner-owner",input,
    [family,chain,...names.slice(0,5).map(name=>fields[name])],options);
}
