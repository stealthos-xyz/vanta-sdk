import {getConfirmedBlock} from './transaction-confirmations.mjs';
/** Shared public KZG policy-table arithmetic and release authentication.
 * The SHA paths here authenticate immutable public SRS keys, not policies.
 * No trapdoor, private receiving key or proving secret is accepted here. */
import {AbiCoder,Interface,concat,getAddress,hexlify,keccak256,sha256,toUtf8Bytes}
  from "ethers";
import {bn254} from "@noble/curves/bn254";

let policyPoseidonPromise;
export async function vantaPolicyPoseidon(values){
  policyPoseidonPromise??=(async()=>{const {buildPoseidon}=await import("#vanta-circom-crypto");return buildPoseidon();})();
  const p=await policyPoseidonPromise;return BigInt(p.F.toObject(p(values)));
}

export const POLICY_FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FQ=21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const N=65_536,FIRST=32,CORPUS_BYTES=N*192;
const OMEGA=0x0eeb2cb5981ed45649abebde081dcff16c8601de4347e7dd1628ba2daac43b7n;
const INV_N=0x30641e0e92bebef818268d663bcad6dbcfd6c0149170f6d7d350b1b1fa6c1001n;
const H32=/^0x[0-9a-f]{64}$/u,H64=/^0x[0-9a-f]{128}$/u;
const coder=AbiCoder.defaultAbiCoder(),Point=bn254.G1.Point;
const SCHEME=keccak256(toUtf8Bytes("VANTA_FAMILY_KZG_POLICY_TABLE_V1"));
const CHECKPOINT=keccak256(toUtf8Bytes("VANTA_FAMILY_KZG_POLICY_CHECKPOINT_V1"));
const publicCorpora=new WeakMap(),verifiedStates=new WeakSet(),tableCaches=new WeakMap(),deploymentChecks=new WeakMap();
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const hash=(value,label)=>{
  if(typeof value!=="string"||!/^0x[0-9a-f]{64}$/iu.test(value)||BigInt(value)===0n)
    throw Error("Unpinned KZG policy "+label+".");
  return value.toLowerCase();
};
const exact=(value,names,label)=>{
  if(!value||typeof value!=="object"||Array.isArray(value)||
     Object.keys(value).length!==names.length||names.some(k=>!Object.hasOwn(value,k)))
    throw Error("Invalid KZG policy "+label+" shape.");
  return value;
};
export const policyField=(value,label="field",zero=false)=>{
  if(typeof value==="number"&&!Number.isSafeInteger(value))
    throw Error("Invalid KZG policy "+label+": number must be a safe integer.");
  const n=BigInt(value);
  if(n<0n||n>=POLICY_FR||!zero&&n===0n)
    throw Error("Invalid KZG policy "+label+".");
  return n;
};
export const policyHex=value=>"0x"+BigInt(value).toString(16).padStart(64,"0");
function resource(value,label){
  exact(value,["path","sha256","bytes"],label);
  if(typeof value.path!=="string"||!value.path||value.path.startsWith("/")||
     /[\\?#:]/u.test(value.path)||value.path.split("/").some(p=>!p||p===".."||p===".")||
     !Number.isSafeInteger(value.bytes)||value.bytes<=0)
    throw Error("Invalid KZG policy "+label+" resource.");
  return Object.freeze({path:value.path,sha256:hash(value.sha256,label),bytes:value.bytes});
}
function verifier(value,label){
  exact(value,["address","codehash"],label);
  const address=getAddress(value.address);
  if(BigInt(address)===0n)throw Error("Zero KZG policy verifier.");
  return Object.freeze({address,codehash:hash(value.codehash,label)});
}
export function validateVantaPartnerPolicyKzgProfile(value){
  const p=exact(value,["schema","chainId","setupId","generationId","familyTag",
    "genesisHash","tableSize","reservedRows","acceptedUpdateKeyRoot","corpus",
    "corpusMetadata","lookupKeys","verifiers"],"profile");
  if(p.schema!=="vanta-kzg-partner-policy-table-v1"||
     !Number.isSafeInteger(p.chainId)||p.chainId<=0||p.tableSize!==N||p.reservedRows!==FIRST)
    throw Error("Unsupported KZG partner policy profile.");
  const familyTag=hash(p.familyTag,"family");
  policyField(familyTag,"family");
  const corpus=resource(p.corpus,"corpus");
  if(corpus.bytes!==CORPUS_BYTES)throw Error("KZG policy corpus must cover all 65,536 rows.");
  const v=exact(p.verifiers,["combined","enhanced"],"verifiers");
  exact(p.lookupKeys,["combined","enhanced"],"lookup keys");
  return Object.freeze({schema:p.schema,chainId:p.chainId,tableSize:N,reservedRows:FIRST,
    setupId:hash(p.setupId,"setup"),generationId:hash(p.generationId,"generation"),
    familyTag,genesisHash:hash(p.genesisHash,"genesis"),
    acceptedUpdateKeyRoot:hash(p.acceptedUpdateKeyRoot,"update key root"),corpus,
    corpusMetadata:resource(p.corpusMetadata,"corpus metadata"),
    lookupKeys:Object.freeze({combined:resource(p.lookupKeys.combined,"combined lookup key"),
      enhanced:resource(p.lookupKeys.enhanced,"enhanced lookup key")}),
    verifiers:Object.freeze({combined:verifier(v.combined,"combined verifier"),
      enhanced:verifier(v.enhanced,"enhanced verifier")})});
}
const point=value=>{
  const x=BigInt(value.x),y=BigInt(value.y);
  if(x<0n||x>=FQ||y<0n||y>=FQ)throw Error("Noncanonical policy commitment.");
  if(x===0n&&y===0n)return Point.ZERO;
  if(y*y%FQ!==(x*x%FQ*x+3n)%FQ)throw Error("Invalid policy commitment curve point.");
  const p=Point.fromAffine({x,y});p.assertValidity();return p;
};
const affine=p=>p.equals(Point.ZERO)?Object.freeze({x:0n,y:0n}):Object.freeze(p.toAffine());
function pow(base,exponent,modulus){
  let result=1n;
  for(;exponent>0n;exponent>>=1n,base=base*base%modulus)
    if(exponent&1n)result=result*base%modulus;
  return result;
}
function decompressG1(bytes){
  if(bytes.length!==32||(bytes[31]&0x40)!==0)throw Error("Invalid public policy SRS point.");
  let x=BigInt(bytes[31]&0x3f);
  for(let i=30;i>=0;i--)x=(x<<8n)|BigInt(bytes[i]);
  if(x>=FQ)throw Error("Noncanonical compressed policy SRS point.");
  const rhs=(x*x%FQ*x+3n)%FQ;
  let y=pow(rhs,(FQ+1n)/4n,FQ);
  if(y*y%FQ!==rhs)throw Error("Public policy SRS point is not on BN254.");
  if((y>FQ-y)!==Boolean(bytes[31]&0x80))y=FQ-y;
  return point({x,y});
}
const shaPair=(left,right)=>sha256(concat([left,right]));
/** Authenticate the complete public recovery corpus, including its G2 sections.
 * The caller obtains the profile from compiled release pins, never a URL manifest. */
export function authenticateVantaPolicyCorpus({profile,corpus,metadata}){
  const p=validateVantaPartnerPolicyKzgProfile(profile);
  if(!(corpus instanceof Uint8Array)||corpus.length!==p.corpus.bytes||
     sha256(corpus)!==p.corpus.sha256||!(metadata instanceof Uint8Array)||
     metadata.length!==p.corpusMetadata.bytes||sha256(metadata)!==p.corpusMetadata.sha256)
    throw Error("KZG policy public corpus differs from compiled SHA-256 pins.");
  let m;try{m=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(metadata));}
  catch{throw Error("Invalid pinned public policy corpus metadata.");}
  if(m.n!==N||m.bytes!==CORPUS_BYTES||m.sha256!==p.corpus.sha256||
     m.lagRoot!==p.acceptedUpdateKeyRoot||!H32.test(m.tauG1)||!H64.test(m.hG2))
    throw Error("Pinned public policy corpus metadata differs from its release.");
  // Copy once, so application mutation cannot change a previously branded corpus.
  const bytes=corpus.slice(),levels=[new Array(N)];
  for(let row=0;row<N;row++)levels[0][row]=sha256(concat([
    bytes.subarray(row*32,(row+1)*32),bytes.subarray((N+row)*32,(N+row+1)*32)]));
  for(let depth=0;depth<16;depth++){
    const previous=levels[depth],next=new Array(previous.length/2);
    for(let i=0;i<next.length;i++)next[i]=shaPair(previous[i*2],previous[i*2+1]);
    levels.push(next);
  }
  if(levels[16][0]!==p.acceptedUpdateKeyRoot)
    throw Error("KZG policy public corpus has a different authenticated SRS root.");
  const result=Object.freeze({profile:p});
  publicCorpora.set(result,{bytes,levels,points:new Map(),tauG1:m.tauG1,hG2:m.hG2});return result;
}
export async function loadVantaPolicyCorpus({profile,baseUrl,fetcher=fetch,signal}){
  const p=validateVantaPartnerPolicyKzgProfile(profile),base=new URL(baseUrl);
  if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash)
    throw Error("Public policy corpus requires a credential-free HTTPS origin.");
  if(!base.pathname.endsWith("/"))base.pathname+="/";
  const read=async pin=>{
    const url=new URL(pin.path,base);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))
      throw Error("Policy resource escapes its pinned base.");
    const response=await fetcher(url,{signal,credentials:"omit",redirect:"error"});
    if(response.status!==200||response.redirected||response.type==="opaque"||!response.body)
      throw Error("Public policy resource is unavailable.");
    const declared=response.headers.get("content-length");
    if(declared!==null&&(!/^[0-9]+$/u.test(declared)||Number(declared)!==pin.bytes))
      throw Error("Policy resource length differs from compiled pin.");
    const bytes=new Uint8Array(pin.bytes),reader=response.body.getReader();let offset=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;
      if(offset+value.length>bytes.length)throw Error("Oversized public policy resource.");
      bytes.set(value,offset);offset+=value.length;
    }}finally{await reader.cancel();reader.releaseLock();}
    if(offset!==bytes.length||sha256(bytes)!==pin.sha256)
      throw Error("Public policy resource failed its compiled SHA-256 pin.");
    return bytes;
  };
  const [corpus,metadata]=await Promise.all([read(p.corpus),read(p.corpusMetadata)]);
  return authenticateVantaPolicyCorpus({profile:p,corpus,metadata});
}
function corpusData(corpus){
  const data=publicCorpora.get(corpus);
  if(!data)throw Error("KZG policy corpus was not authenticated by this SDK.");
  return data;
}
function aPoint(data,row){
  let p=data.points.get(row);
  if(!p){p=decompressG1(data.bytes.subarray(row*32,(row+1)*32));data.points.set(row,p);}
  return p;
}
export function buildVantaPolicyRowKeys(corpus,rows){
  const data=corpusData(corpus);
  if(!Array.isArray(rows)||rows.length!==6||new Set(rows).size!==6||
     rows.some(row=>!Number.isInteger(row)||row<FIRST||row>=N))
    throw Error("A policy update needs six distinct authenticated SRS rows.");
  return Object.freeze(rows.map(row=>Object.freeze({
    a:affine(aPoint(data,row)),
    u:affine(decompressG1(data.bytes.subarray((N+row)*32,(N+row+1)*32))),
    aCompressed:hexlify(data.bytes.subarray(row*32,(row+1)*32)),
    uCompressed:hexlify(data.bytes.subarray((N+row)*32,(N+row+1)*32)),
    siblings:Object.freeze(Array.from({length:16},(_,depth)=>data.levels[depth][(row>>depth)^1])),
  })));
}
export function reproduceVantaPolicyCommitment(corpus,rows){
  const data=corpusData(corpus);
  if(!Array.isArray(rows)||rows.length<FIRST||rows.length>N)
    throw Error("Invalid public KZG policy table length.");
  let result=Point.ZERO,omega=1n;
  for(let row=0;row<rows.length;row++,omega=omega*OMEGA%POLICY_FR){
    const value=policyField(rows[row],"table row",true);
    if(row<FIRST&&value!==0n)throw Error("Reserved KZG policy rows must remain zero.");
    if(value)result=result.add(aPoint(data,row).multiplyUnsafe(value*omega%POLICY_FR*INV_N%POLICY_FR));
  }
  return affine(result);
}
export function applyVantaPolicyUpdates(corpus,commitment,changes){
  const data=corpusData(corpus),seen=new Set();let next=point(commitment);
  if(!Array.isArray(changes)||changes.length!==6)throw Error("Atomic policy update requires six rows.");
  for(const change of changes){
    const row=change.row;
    if(!Number.isInteger(row)||row<FIRST||row>=N||seen.has(row))throw Error("Invalid policy update row.");
    seen.add(row);
    const before=policyField(change.before,"old row",true),after=policyField(change.after,"new row",true);
    const delta=(after-before+POLICY_FR)%POLICY_FR;
    if(delta)next=next.add(aPoint(data,row).multiplyUnsafe(delta*pow(OMEGA,BigInt(row),POLICY_FR)%POLICY_FR*INV_N%POLICY_FR));
  }
  return affine(next);
}
export function vantaPolicyCheckpoint({profile,registry,pool,asset,revision,nextSlot,commitment}){
  const p=validateVantaPartnerPolicyKzgProfile(profile);
  point(commitment);
  if(!Number.isSafeInteger(nextSlot)||nextSlot<FIRST||nextSlot>N||
     BigInt(revision)<0n||BigInt(revision)>=(1n<<64n))throw Error("Invalid KZG policy checkpoint metadata.");
  return BigInt(keccak256(coder.encode([
    "bytes32","uint256","address","bytes32","bytes32","bytes32","bytes32",
    "address","address","uint64","uint32","uint256","uint256"],
  [CHECKPOINT,p.chainId,getAddress(registry),p.setupId,p.generationId,p.familyTag,
    p.acceptedUpdateKeyRoot,getAddress(pool),getAddress(asset),revision,nextSlot,
    commitment.x,commitment.y])))%POLICY_FR;
}
export async function vantaPolicyContext({profile,registry,pool,asset,poseidon}){
  const p=validateVantaPartnerPolicyKzgProfile(profile),mask=(1n<<128n)-1n;
  const fields=[1n,BigInt(p.chainId),BigInt(getAddress(registry)),
    BigInt(p.setupId)&mask,BigInt(p.setupId)>>128n,
    BigInt(p.generationId)&mask,BigInt(p.generationId)>>128n,BigInt(p.familyTag),
    BigInt(getAddress(pool)),BigInt(getAddress(asset))];
  let current=0x56414e54414b5a47504f4c49435901n;
  for(let i=0;i<fields.length;i+=2)current=await poseidon([current,fields[i],fields[i+1]]);
  return policyField(current,"context");
}
export async function vantaPolicyLeaf({context,basePartnerId,operation,version,
  receiverCommitment,feeBps,feeMinimum,feeMaximum,authorizationKey,poseidon}){
  if(!Number.isInteger(operation)||operation<0||operation>5)throw Error("Invalid policy operation.");
  const id=await poseidon([policyField(basePartnerId,"base partner"),BigInt(operation)]);
  const fields=[id,BigInt(version),receiverCommitment,BigInt(feeBps),feeMinimum,feeMaximum,
    authorizationKey,BigInt(operation)].map(v=>policyField(v,"leaf field",true));
  let leaf=policyField(context,"context");
  for(let i=0;i<fields.length;i+=2)leaf=await poseidon([leaf,fields[i],fields[i+1]]);
  return policyField(leaf,"leaf");
}
export const VANTA_POLICY_REGISTRY_ABI=new Interface([
  "function REGISTRY_SCHEME() view returns(bytes32)",
  "function acceptedUpdateKeyRoot() view returns(bytes32)",
  "function releaseSetupId() view returns(bytes32)",
  "function releaseGenerationId() view returns(bytes32)",
  "function releaseFamilyTag() view returns(bytes32)",
  "function releaseChainId() view returns(uint256)",
  "function administrator() view returns(address)",
  "function activePoolForAsset(address) view returns(address)",
  "function poolState(address) view returns(address asset,uint256 root,uint32 nextSlot,bool approved)",
  "function poolCommitment(address) view returns(uint256 x,uint256 y,uint64 revision)",
  "function poolPolicyContext(address) view returns(uint256)",
  "function partnerSlot(address,bytes32) view returns(bool found,uint16 slot)",
  "function partnerAt(address,uint16) view returns(tuple(bytes32 partnerId,uint64 version,uint256 receiverCommitment,uint16 feeBps,uint128 feeMinimum,uint128 feeMaximum,uint256 authorizationKey,bool active,uint256 leaf))",
  "function operationPartnerId(uint256,uint8) view returns(bytes32)",
  "function partnerLeaf(address,uint256,uint8,uint64,uint256,uint16,uint128,uint128,uint256) view returns(uint256)",
  "event PartnerVersionChanged(address indexed pool,bytes32 indexed partnerId,uint16 slot,uint64 version,uint256 receiverCommitment,uint16 feeBps,uint128 feeMinimum,uint128 feeMaximum,bool active,uint256 root)",
]);
export const VANTA_POLICY_ROW_KEY_TUPLE="tuple(tuple(uint256 x,uint256 y) a,tuple(uint256 x,uint256 y) u,bytes32 aCompressed,bytes32 uCompressed,bytes32[16] siblings)";
export async function policyReadBoth(context,to,abi,method,args=[]){
  const tx={to,data:abi.encodeFunctionData(method,args),blockTag:context.block};
  const [a,b]=await Promise.all([context.provider.call(tx),context.verificationProvider.call(tx)]);
  if(!same(a,b))throw Error("KZG policy RPCs disagree on "+method+".");
  return abi.decodeFunctionResult(method,a);
}
export async function finalizedPolicyContext({provider,verificationProvider,profile,pins}){
  const p=validateVantaPartnerPolicyKzgProfile(profile);
  if(!provider||!verificationProvider||provider===verificationProvider)
    throw Error("KZG partner policy requires independent confirmation RPCs.");
  const [a,b,fa,fb,ga,gb]=await Promise.all([provider.getNetwork(),verificationProvider.getNetwork(),
    getConfirmedBlock(provider),getConfirmedBlock(verificationProvider),
    provider.getBlock(0),verificationProvider.getBlock(0)]);
  if(BigInt(a.chainId)!==BigInt(p.chainId)||BigInt(b.chainId)!==BigInt(p.chainId)||
     !same(ga?.hash,p.genesisHash)||!same(gb?.hash,p.genesisHash)||
     !Number.isSafeInteger(fa?.number)||!Number.isSafeInteger(fb?.number))
    throw Error("KZG policy network or confirmation anchor differs from the compiled release.");
  const block=Math.min(fa.number,fb.number);
  const [ba,bb]=await Promise.all([provider.getBlock(block),verificationProvider.getBlock(block)]);
  if(!H32.test(ba?.hash?.toLowerCase()??"")||!same(ba.hash,bb?.hash))
    throw Error("KZG policy confirmed block differs between RPCs.");
  if(!Array.isArray(pins)||pins.length===0)throw Error('KZG policy dependencies are missing.');
  // This memory-only result belongs to this freshly observed canonical block
  // hash AND exact signed scope. A new block, peer, release or pin set rechecks
  // bytecode. No persisted trusted flag or TTL can authorize a funded action.
  let peers=deploymentChecks.get(provider);if(!peers){peers=new WeakMap();deploymentChecks.set(provider,peers);}
  let observations=peers.get(verificationProvider);if(!observations){observations=new Map();peers.set(verificationProvider,observations);}
  const key=JSON.stringify([p,block,ba.hash.toLowerCase(),pins.map(pin=>[getAddress(pin.address),pin.codehash.toLowerCase()]).sort()]);
  let work=observations.get(key);
  if(!work){
    work=(async()=>{let cursor=0;const checked=[];
      await Promise.all(Array.from({length:Math.min(4,pins.length)},async()=>{for(;;){
        const index=cursor++;if(index>=pins.length)return;const pin=pins[index];
        const [ca,cb]=await Promise.all([provider.getCode(pin.address,block),verificationProvider.getCode(pin.address,block)]);
        if(ca==='0x'||cb==='0x'||!same(keccak256(ca),pin.codehash)||!same(keccak256(cb),pin.codehash))
          throw Error('KZG policy bytecode differs from compiled release pins.');
        checked[index]=Object.freeze({address:getAddress(pin.address),codehash:pin.codehash});
      }}));return Object.freeze(checked);
    })();
    observations.set(key,work);while(observations.size>64)observations.delete(observations.keys().next().value);
  }
  try{await work;}catch(error){if(observations.get(key)===work)observations.delete(key);throw error;}
  const result=Object.freeze({provider,verificationProvider,block,blockHash:ba.hash.toLowerCase(),profile:p});
  await assertStablePolicyContext(result);return result;
}
export async function assertStablePolicyContext(context){
  const [a,b]=await Promise.all([context.provider.getBlock(context.block),context.verificationProvider.getBlock(context.block)]);
  if(!same(a?.hash,context.blockHash)||!same(b?.hash,context.blockHash))
    throw Error("KZG policy confirmed block changed during verification.");
}
/** Public rows are read from both confirmation RPCs with bounded concurrency.
 * Zero unallocated/revoked rows are valid. Membership callers reject zero queries. */
export async function readVantaPolicyTable({context,registry,pool,asset,corpus,poseidon}){
  corpusData(corpus);
  if(corpus.profile.corpus.sha256!==context.profile.corpus.sha256||
     corpus.profile.acceptedUpdateKeyRoot!==context.profile.acceptedUpdateKeyRoot)
    throw Error("Policy corpus belongs to another release.");
  const abi=VANTA_POLICY_REGISTRY_ABI,read=(name,args=[])=>policyReadBoth(context,registry,abi,name,args);
  const [scheme,srs,setup,generation,family,chain,active,state,commit,ctx]=await Promise.all([
    read("REGISTRY_SCHEME"),read("acceptedUpdateKeyRoot"),read("releaseSetupId"),
    read("releaseGenerationId"),read("releaseFamilyTag"),read("releaseChainId"),
    read("activePoolForAsset",[asset]),read("poolState",[pool]),
    read("poolCommitment",[pool]),read("poolPolicyContext",[pool])]);
  const p=context.profile,nextSlot=Number(state.nextSlot),revision=BigInt(commit.revision);
  if(!same(scheme[0],SCHEME)||!same(srs[0],p.acceptedUpdateKeyRoot)||
     !same(setup[0],p.setupId)||!same(generation[0],p.generationId)||!same(family[0],p.familyTag)||
     BigInt(chain[0])!==BigInt(p.chainId)||!same(active[0],pool)||!same(state.asset,asset)||
     !state.approved||!Number.isInteger(nextSlot)||nextSlot<FIRST||nextSlot>N)
    throw Error("Unsupported or mismatched authenticated KZG policy table.");
  const commitment=affine(point({x:commit.x,y:commit.y})),root=policyField(state.root,"checkpoint");
  const policyContext=await vantaPolicyContext({profile:p,registry,pool,asset,poseidon});
  if(policyField(ctx[0],"context")!==policyContext||
     vantaPolicyCheckpoint({profile:p,registry,pool,asset,revision,nextSlot,commitment})!==root)
    throw Error("KZG policy context or checkpoint does not match its full release scope.");
  // A checkpoint includes revision, slot count and commitment. Reuse its
  // immutable public table while still checking current metadata on both RPCs.
  let peers=tableCaches.get(context.provider);
  if(!peers){peers=new WeakMap();tableCaches.set(context.provider,peers);}
  let cache=peers.get(context.verificationProvider);
  if(!cache){cache=new Map();peers.set(context.verificationProvider,cache);}
  const cacheKey=[registry.toLowerCase(),pool.toLowerCase(),root.toString(),p.corpus.sha256].join("|");
  const prior=cache.get(cacheKey);
  if(prior){
    const cached=await prior;await assertStablePolicyContext(context);
    const result=Object.freeze({...cached,finalizedBlock:context.block,finalizedBlockHash:context.blockHash});
    verifiedStates.add(result);return result;
  }
  const pending=(async()=>{
  const records=new Array(nextSlot).fill(null),rows=new Array(nextSlot).fill(0n);let cursor=FIRST;
  await Promise.all(Array.from({length:Math.min(16,nextSlot-FIRST)},async()=>{
    for(;;){const slot=cursor++;if(slot>=nextSlot)return;
      const [record]=await read("partnerAt",[pool,slot]);
      const leaf=policyField(record.leaf,"public table leaf",true);
      if(Boolean(record.active)!==(leaf!==0n))throw Error("Revoked policy retains a nonzero table row.");
      records[slot]=Object.freeze([...record]);rows[slot]=leaf;
    }
  }));
  const reproduced=reproduceVantaPolicyCommitment(corpus,rows);
  if(reproduced.x!==commitment.x||reproduced.y!==commitment.y)
    throw Error("Public policy rows do not reproduce the current KZG commitment.");
  await assertStablePolicyContext(context);
  const result=Object.freeze({registry:getAddress(registry),pool:getAddress(pool),asset:getAddress(asset),
    root,nextSlot,revision,commitment,policyContext,records:Object.freeze(records),rows:Object.freeze(rows),
    finalizedBlock:context.block,finalizedBlockHash:context.blockHash});
  verifiedStates.add(result);return result;
  })();
  cache.set(cacheKey,pending);
  while(cache.size>4)cache.delete(cache.keys().next().value);
  try{return await pending;}catch(error){cache.delete(cacheKey);throw error;}

}
/** Select locally after downloading the public table. Never disclose a private
 * operation identity in a targeted RPC read. Identifier tombstones are unique. */
export function findVantaPolicyRecord(table,partnerId){
  if(!verifiedStates.has(table))throw Error("Policy selection requires an authenticated table.");
  const id=policyHex(policyField(partnerId,"operation identity"));
  let selected;
  for(let slot=FIRST;slot<table.nextSlot;slot++){
    const record=table.records[slot];
    if(!record||!same(record[0],id))continue;
    if(selected)throw Error("Duplicate operation identities in the authenticated policy table.");
    selected={slot,record};
  }
  if(!selected||selected.record[7]!==true||table.rows[selected.slot]===0n)
    throw Error("Unknown or revoked KZG partner policy.");
  return Object.freeze(selected);
}
export async function prepareVantaPolicyBatch({context,table,corpus,basePartnerId,
  receiverCommitment,authorizationCommitment,fees,registration=false,revoke=false,poseidon}){
  if(!verifiedStates.has(table)||registration&&revoke||!Array.isArray(fees)||fees.length!==6)
    throw Error("Policy batch requires an authenticated table and six operations.");
  const rows=[],versions=[],changes=[];
  for(let operation=0;operation<6;operation++){
    const partnerId=policyHex(await poseidon([policyField(basePartnerId,"base partner"),BigInt(operation)]));
    const [found,slotValue]=await policyReadBoth(context,table.registry,VANTA_POLICY_REGISTRY_ABI,
      "partnerSlot",[table.pool,partnerId]);
    const slot=registration?table.nextSlot+operation:Number(slotValue),old=registration?null:table.records[slot];
    if(registration?Boolean(found)||slot>=N:
      !found||!old||slot<FIRST||slot>=table.nextSlot||old[7]!==true||
      !same(old[0],partnerId)||BigInt(old[2])!==receiverCommitment||
      BigInt(old[6])!==authorizationCommitment||table.rows[slot]===0n)
      throw Error("Policy update is duplicate, missing, revoked or changes its immutable collector.");
    const version=registration?1n:BigInt(old[1])+1n;
    if(version>=(1n<<64n))throw Error("Policy version is exhausted.");
    const fee=fees[operation];
    if(!Number.isInteger(fee.feeBps)||fee.feeBps<0||fee.feeBps>10_000||
       fee.minimumFee<0n||fee.maximumFee<fee.minimumFee||fee.maximumFee>=(1n<<120n)||
       (fee.feeBps===0?fee.minimumFee!==fee.maximumFee:fee.maximumFee===0n))
      throw Error("Policy batch differs from exact fee bounds.");
    const after=revoke?0n:await vantaPolicyLeaf({context:table.policyContext,basePartnerId,operation,
      version,receiverCommitment,feeBps:fee.feeBps,feeMinimum:fee.minimumFee,
      feeMaximum:fee.maximumFee,authorizationKey:authorizationCommitment,poseidon});
    rows.push(slot);versions.push(version);changes.push({row:slot,before:registration?0n:table.rows[slot],after});
  }
  const commitment=applyVantaPolicyUpdates(corpus,table.commitment,changes),revision=table.revision+1n,
    nextSlot=table.nextSlot+(registration?6:0);
  const nextRoot=vantaPolicyCheckpoint({profile:context.profile,registry:table.registry,pool:table.pool,
    asset:table.asset,revision,nextSlot,commitment});
  return Object.freeze({keys:buildVantaPolicyRowKeys(corpus,rows),root:table.root,nextRoot,
    versions:Object.freeze(versions),commitment,revision,nextSlot});
}
export async function buildVantaPolicyLookup({table,slot,corpus,runtime}){
  const data=corpusData(corpus);
  if(!verifiedStates.has(table)||!Number.isInteger(slot)||slot<FIRST||slot>=table.nextSlot||
     table.rows[slot]===0n||typeof runtime?.buildVantaKzgPolicyLookup!=="function")
    throw Error("KZG policy lookup requires an authenticated active row and pinned recovery runtime.");
  if(table.revision>BigInt(Number.MAX_SAFE_INTEGER))throw Error("KZG policy revision exceeds the browser JSON range.");
  const state={pool:table.pool,asset:table.asset,checkpoint:policyHex(table.root),
    revision:Number(table.revision),next_slot:table.nextSlot,
    commitment:{x:policyHex(table.commitment.x),y:policyHex(table.commitment.y)},
    policy_context:policyHex(table.policyContext),registry_slot:slot,
    rows:table.rows.map(policyHex),tau_g1:data.tauG1,h_g2:data.hG2,
    corpus_sha256:corpus.profile.corpus.sha256.slice(2),
    accepted_update_key_root:corpus.profile.acceptedUpdateKeyRoot};
  const raw=await runtime.buildVantaKzgPolicyLookup(data.bytes.slice(),JSON.stringify(state));
  let result;try{result=typeof raw==="string"?JSON.parse(raw):raw;}catch{throw Error("Invalid policy lookup recovery response.");}
  exact(result,["pool","asset","checkpoint","revision","next_slot","commitment","policy_context",
    "registry_slot","query_root","value","w1_g2","w2_g2"],"lookup witness");
  for(const name of ["pool","asset","checkpoint","policy_context"])
    if(!same(result[name],state[name]))throw Error("Recovered KZG policy lookup scope differs.");
  if(result.revision!==state.revision||result.next_slot!==state.next_slot||result.registry_slot!==slot||
     !same(result.commitment?.x,state.commitment.x)||!same(result.commitment?.y,state.commitment.y)||
     result.value!==policyHex(table.rows[slot])||result.query_root!==policyHex(pow(OMEGA,BigInt(slot),POLICY_FR))||
     !H64.test(result.w1_g2)||!H64.test(result.w2_g2))
    throw Error("Recovered KZG policy lookup differs from the authenticated public table.");
  return Object.freeze({...result,commitment:Object.freeze({...result.commitment})});
}
/** Every owner action binds release, network and the complete ordered asset/pool list. */
export function vantaPolicyOwnerAction({kind,profile,registrar,registry,pools,checkpoints,
  handleId,authorizationCommitment,receiverCommitment,routingCommitment,salt,fees,revision,deadline,assetIndex}){
  const p=validateVantaPartnerPolicyKzgProfile(profile);
  if(!Array.isArray(pools)||pools.length<2||pools.length>8||new Set(pools.map(p=>getAddress(p).toLowerCase())).size!==pools.length||
     !Array.isArray(checkpoints)||checkpoints.length!==pools.length)
    throw Error("Owner policy action requires every canonical pool checkpoint.");
  if(assetIndex!==undefined){
    if(!Number.isInteger(assetIndex)||assetIndex<0||assetIndex>=pools.length||typeof revision!=="bigint"||revision<1n||revision>=(1n<<64n))
      throw Error("Invalid owner-authorized asset or revision.");
    const name={register:"REGISTER",update:"UPDATE",revoke:"REVOKE"}[kind];
    if(!name)throw Error("Invalid owner asset action.");
    const types=["bytes32","uint256","address","bytes32","bytes32","bytes32","bytes32","bytes32","uint256"];
    const values=[keccak256(toUtf8Bytes("VANTA_PARTNER_KZG_"+name+"_ASSET_PROOF_V3")),p.chainId,
      registrar,p.setupId,p.generationId,p.familyTag,p.genesisHash,handleId,authorizationCommitment];
    if(kind==="register"){types.push("uint256","bytes32","bytes32");values.push(receiverCommitment,routingCommitment,salt);}
    if(kind!=="revoke"){types.push("bytes32");values.push(keccak256(coder.encode([
      "tuple(uint16 feeBps,uint128 minimumFee,uint128 maximumFee)[6]"],[fees])));}
    types.push("uint8","address","address","uint256","uint64","uint64");
    values.push(assetIndex,registry,pools[assetIndex],policyField(checkpoints[assetIndex],"checkpoint"),revision,deadline);
    return policyField(BigInt(keccak256(coder.encode(types,values)))%POLICY_FR,"owner asset action");
  }
  const snapshot=keccak256(coder.encode(["address","address[]","uint256[]"],
    [registry,pools,checkpoints.map(x=>policyField(x,"checkpoint"))]));
  const names={register:"REGISTER",update:"UPDATE",revoke:"REVOKE"};
  if(!names[kind])throw Error("Invalid owner policy action.");
  const types=["bytes32","uint256","address","bytes32","bytes32","bytes32","bytes32","bytes32","uint256"];
  const values=[keccak256(toUtf8Bytes("VANTA_PARTNER_KZG_"+names[kind]+"_PROOF_V2")),p.chainId,
    registrar,p.setupId,p.generationId,p.familyTag,p.genesisHash,handleId,authorizationCommitment];
  if(kind==="register"){
    types.push("uint256","bytes32","bytes32");values.push(receiverCommitment,routingCommitment,salt);
  }
  if(kind!=="revoke"){
    types.push("bytes32");values.push(keccak256(coder.encode([
      "tuple(uint16 feeBps,uint128 minimumFee,uint128 maximumFee)[6]"],
    [fees.map(f=>[f.feeBps,f.minimumFee,f.maximumFee])])));
  }
  if(kind!=="register"){types.push("uint64");values.push(revision);}
  types.push("bytes32","uint64");values.push(snapshot,deadline);
  return policyField(BigInt(keccak256(coder.encode(types,values)))%POLICY_FR,"owner action");
}
