/** Typed ordinary Groth16 component composition. The public factory fixes
 * the release, independently authenticated pool and byte-pinned WASM/keys. */
const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const require=(ok,message)=>{if(!ok)throw Error(message);};
const json=value=>JSON.stringify(value);
const parse=text=>{require(typeof text==="string"&&text.length<=128*1024,"Invalid ordinary component response.");return JSON.parse(text);};
const signals=(value,count)=>{require(Array.isArray(value)&&value.length===count&&value.every(v=>
  typeof v==="string"&&/^(0|[1-9][0-9]*)$/u.test(v)&&BigInt(v)<FR),"Wrong ordinary component public layout.");return Object.freeze([...value]);};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>BigInt(v)===BigInt(b[i]));
export function composeVantaFamilyEnhancedComponents({domain,load,verifyProof,authenticateClaim,verifyActivation,signal}){
  let disposed=false,busy=false,prepared=new WeakMap();
  const live=()=>{signal?.throwIfAborted();require(!disposed,"Enhanced components are disposed.");};
  const session=async work=>{
    live();require(!busy,"An ordinary enhanced operation is already running.");busy=true;
    try{await verifyActivation();live();const result=await work();live();return result;}finally{busy=false;}
  };
  const release=key=>({...domain,provingKeySha256:key.replace(/^0x/u,"")});
  const pinSignals=(values,authorization)=>{
    const offset=authorization?4:7;
    for(const [i,key] of [[0,"familyTag"],[1,"chainId"],[2,"pool"],[3,"asset"]])
      require(BigInt(values[offset+i])===BigInt(domain[key]),"Ordinary proof changed its pinned domain.");
    for(const [i,key] of [[offset+4,"genesisHash"],[offset+6,"generationId"]]){
      const n=BigInt(domain[key]);require(BigInt(values[i])===(n&((1n<<128n)-1n))&&BigInt(values[i+1])===(n>>128n),"Ordinary proof changed its pinned bytes32 limbs.");
    }
  };
  const prove=async(record,role,onLocalProof)=>{
    const loaded=await load(role),key=await loaded.key();
    try{
      const raw=role==="enhanced-authorization"
        ?await loaded.proveAuthorization(record.witness,record.release,key)
        :loaded.wasm.prove_enhanced_claim_capability(record.capability,record.refresh,key);
      const result=parse(raw),values=signals(result.publicSignals,role==="enhanced-authorization"?19:15);
      require(result.verified===true&&result.safeForFunds===false&&same(values,record.signals),"Ordinary prover changed the prepared statement.");
      pinSignals(values,role==="enhanced-authorization");
      live();
      onLocalProof?.();
      await verifyProof(role,result.proof,values);live();
      await verifyActivation();live();
      return Object.freeze({...result,role,publicSignals:values,engine:"ordinary-groth16",fundedTransactionProof:false});
    }finally{if(key.byteLength)key.fill(0);}
  };
  const inspect = (loaded, capability) => {
    const summary=parse(loaded.wasm.inspect_enhanced_claim_capability(json(capability)));
    require(summary&&summary.safeForFunds===false&&summary.domain&&Object.entries(domain).every(([key,value])=>
      String(summary.domain[key]).toLowerCase()===String(value).toLowerCase()),"Claim capability differs from the pinned release.");
    return Object.freeze(summary);
  };
  return Object.freeze({
    async inspectClaim({capability}){return session(async()=>inspect(await load("enhanced-claim"),capability));},
    async inspectClaims({capabilities}){
      require(Array.isArray(capabilities) && capabilities.length === 3, "Expected three claim capabilities.");
      const claims = structuredClone(capabilities);
      return session(async () => {
        const loaded = await load("enhanced-claim");
        return Array.from(claims, capability => inspect(loaded, capability));
      });
    },
    async prepareAuthorization({witness}){return session(async()=>{
      const loaded=await load("enhanced-authorization"),text=json(witness),r=json(release(loaded.provingKeySha256));
      const result=parse(loaded.wasm.prepare_enhanced_authorization(text,r));
      require(result.schema==="vanta-enhanced-authorization-prepared-v1"&&result.role==="enhanced-authorization"&&result.safeForFunds===false,
        "Wrong typed authorization response.");
      const values=signals(result.publicSignals,19);pinSignals(values,true);
      require(result.claimCapabilities?.safeForFunds===false&&result.claimCapabilities?.claims?.length===3,
        "Authorization did not export its fixed reservation capabilities.");
      const output=Object.freeze({...result,publicSignals:values});
      prepared.set(output,{role:"enhanced-authorization",witness:text,release:r,signals:values});return output;
    });},
    async proveAuthorization({authorization,onLocalProof}){return session(async()=>{
      const record=prepared.get(authorization);require(record?.role==="enhanced-authorization","Authorization was not prepared by this local component.");
      try{return await prove(record,record.role,onLocalProof);}finally{prepared.delete(authorization);}
    });},
    async prepareClaim({capability,refresh}){return session(async()=>{
      const loaded=await load("enhanced-claim"),c=json(capability),snapshot=structuredClone(refresh);
      require(snapshot&&Object.keys(snapshot).sort().join()==="checkpoint,expected,predecessorPaths,reservationPath,safeForFunds,schema",
        "The SDK supplies the claim release pins.");
      const r={...snapshot,release:release(loaded.provingKeySha256)};
      await authenticateClaim(r);live();
      const result=parse(loaded.wasm.prepare_enhanced_claim_request(c,json(r)));
      require(result.schema==="vanta-enhanced-claim-prepared-v1"&&result.safeForFunds===false,"Wrong claim preparation response.");
      const values=signals(result.publicSignals,15);pinSignals(values,false);
      // Internal canonical serialization never crosses this typed API.
      const {proofRequest:_privateRequest,...publicResult}=result;
      const output=Object.freeze({...publicResult,publicSignals:values});
      prepared.set(output,{role:"enhanced-claim",capability:c,refresh:json(r),checkpoint:r,signals:values});return output;
    });},
    async proveClaim({claim}){return session(async()=>{
      const record=prepared.get(claim);require(record?.role==="enhanced-claim","Claim was not prepared by this local component.");
      try{
        await authenticateClaim(record.checkpoint);live();
        const result=await prove(record,record.role);
        await authenticateClaim(record.checkpoint);live();return result;
      }finally{prepared.delete(claim);}
    });},
    dispose(){disposed=true;prepared=new WeakMap();},
  });
}
