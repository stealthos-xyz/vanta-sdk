/** Short-lived partner authorization for one exact family deposit quote request.
 * The public wallet wrapper supplies only its compiled release and signer. */
import {isFamilyAssetSelection} from './family-funding-resources.mjs';
import {getAddress,isHexString,randomBytes,hexlify,toBeHex,
  verifyTypedData} from "ethers";

const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const CAP=(1n<<120n)-1n;
const H32=/^0x[0-9a-f]{64}$/iu;
export const FRESH_PARTNER_DEPOSIT_AUTH_TYPES=Object.freeze({
  PartnerDepositAuthorization:Object.freeze([
    ["handleId","bytes32"],["pool","address"],["asset","address"],
    ["payer","address"],["count","uint8"],["gross","uint128"],
    ["protocolFeeCap","uint128"],["partnerFeeCap","uint128"],
    ["outputsHash","bytes32"],["envelopesHash","bytes32"],
    ["feeSlotsHash","bytes32"],["feeTermsHash","uint256"],
    ["partnerRegistryRoot","uint256"],["signerSalt","uint256"],
    ["requestNonce","bytes32"],["deadline","uint64"],
  ].map(([name,type])=>Object.freeze({name,type}))),
});
const exact=(value,fields)=>value&&typeof value==="object"&&
  !Array.isArray(value)&&Object.keys(value).sort().join()===
    fields.slice().sort().join();
const hash=(value,label)=>{
  if(typeof value!=="string"||!H32.test(value))
    throw Error("Invalid family "+label+" hash.");
  return value.toLowerCase();
};
const units=(value,label,max)=>{
  if(typeof value!=="string"||!/^(0|[1-9][0-9]*)$/u.test(value)||
     value.length>80||BigInt(value)>max)
    throw Error("Invalid family "+label+" units.");
  return BigInt(value);
};
export async function verifyFamilyDepositPartnerAuthorization({release,resources,asset,
  handleId,request,authorization,authorizationCommitment,
  now=Math.floor(Date.now()/1000)}){
  if(!authorization||typeof authorization!=="object"||
     Array.isArray(authorization)||
     Object.keys(authorization).sort().join()!==[
       "handleId","signerSalt","requestNonce","deadline","signature"
     ].sort().join()||
     !Number.isSafeInteger(resources?.chainId)||!isFamilyAssetSelection(asset)||
     !exact(request,["payer","count","gross","protocolFeeCap",
       "partnerFeeCap","outputsHash","envelopesHash","feeSlotsHash",
       "feeTermsHash","partnerRegistryRoot"])||
     !Number.isSafeInteger(now)||
     !Number.isSafeInteger(authorization.deadline)||
     authorization.deadline<=now+30||authorization.deadline>now+300||
     !isHexString(authorization.signature,65))
    throw Error("Family partner-host authorization is malformed or expired.");
  const rows=release.lock.contracts.filter(r=>r.name==="partner-registrar");
  const pin=rows.length===1?{pool:resources.deployment.pool,assetAddress:resources.deployment.asset,
    modules:{partnerRegistrar:rows[0]}}:null;
  if(!pin||!pin.modules?.partnerRegistrar?.address||
     hash(authorization.handleId,"handle ID")!==
       hash(handleId,"handle ID"))
    throw Error("Family partner-host authorization targets another handle.");
  const salt=BigInt(hash(authorization.signerSalt,"signer salt")),
    nonce=hash(authorization.requestNonce,"request nonce"),
    commitment=BigInt(authorizationCommitment);
  if(salt<=0n||salt>=FR||BigInt(nonce)===0n||
     commitment<=0n||commitment>=FR||request.count!==3)
    throw Error("Family partner-host authority field is invalid.");
  const gross=units(request.gross,"gross",CAP),
    protocolFeeCap=units(request.protocolFeeCap,"protocol fee",CAP),
    partnerFeeCap=units(request.partnerFeeCap,"partner fee",CAP),
    feeTermsHash=units(request.feeTermsHash,"fee terms",FR-1n),
    partnerRegistryRoot=units(request.partnerRegistryRoot,
      "partner root",FR-1n);
  if(gross===0n||protocolFeeCap!==0n||partnerFeeCap>=gross||
     feeTermsHash===0n||partnerRegistryRoot===0n)
    throw Error("Family partner-host request does not preserve owned value.");
  const domain={name:"Vanta Partner Quote",version:"2",chainId:resources.chainId,
    verifyingContract:getAddress(pin.modules.partnerRegistrar.address)};
  const message={handleId:authorization.handleId,pool:getAddress(pin.pool),
    asset:getAddress(pin.assetAddress),payer:getAddress(request.payer),
    count:3,gross,protocolFeeCap,partnerFeeCap,
    outputsHash:hash(request.outputsHash,"outputs"),
    envelopesHash:hash(request.envelopesHash,"envelopes"),
    feeSlotsHash:hash(request.feeSlotsHash,"fee slots"),feeTermsHash,
    partnerRegistryRoot,signerSalt:salt,requestNonce:nonce,
    deadline:authorization.deadline};
  let signer;
  try{signer=getAddress(verifyTypedData(domain,
    FRESH_PARTNER_DEPOSIT_AUTH_TYPES,message,authorization.signature));}
  catch{throw Error("Family partner-host signature is invalid.");}
  const {buildPoseidon}=await import("#vanta-circom-crypto");
  const poseidon=await buildPoseidon();
  const owner=BigInt(poseidon.F.toObject(poseidon([
    BigInt(signer),salt])));
  if(owner!==commitment)
    throw Error("Family partner-host signer differs from finalized owner.");
  return Object.freeze({...authorization});
}

export async function signFamilyDepositPartnerAuthorization({release,resources,asset,
  handleId,request,signer,signerSalt,deadline,requestNonce,now=Math.floor(
    Date.now()/1000)}){
  if(!Number.isSafeInteger(resources?.chainId)||!H32.test(resources.generationId)||
     !isFamilyAssetSelection(asset)||
     typeof signer?.signTypedData!=="function"||
     !Number.isSafeInteger(now)||
     !Number.isSafeInteger(deadline)||deadline<=now||deadline>now+300)
    throw Error("Family partner quote requires a compiled release and short expiry.");
  const rows=release.lock.contracts.filter(r=>r.name==="partner-registrar");
  const pin=rows.length===1?{pool:resources.deployment.pool,assetAddress:resources.deployment.asset,
    modules:{partnerRegistrar:rows[0]}}:null;
  if(!pin||!pin.modules?.partnerRegistrar?.address||
     !exact(request,["payer","count","gross","protocolFeeCap",
       "partnerFeeCap","outputsHash","envelopesHash","feeSlotsHash",
       "feeTermsHash","partnerRegistryRoot"]))
    throw Error("Family partner quote request or release is incomplete.");
  const id=hash(handleId,"handle ID"),
    salt=BigInt(signerSalt),
    nonce=hash(requestNonce??hexlify(randomBytes(32)),"request nonce");
  if(BigInt(id)<=0n||BigInt(id)>=FR||salt<=0n||salt>=FR||
     BigInt(nonce)===0n||request.count!==3)
    throw Error("Family partner identity or quote nonce is invalid.");
  const gross=units(request.gross,"gross",CAP),
    protocolFeeCap=units(request.protocolFeeCap,"protocol fee",CAP),
    partnerFeeCap=units(request.partnerFeeCap,"partner fee",CAP),
    feeTermsHash=units(request.feeTermsHash,"fee terms",FR-1n),
    partnerRegistryRoot=units(request.partnerRegistryRoot,
      "partner root",FR-1n);
  if(gross===0n||protocolFeeCap!==0n||partnerFeeCap>=gross||
     feeTermsHash===0n||partnerRegistryRoot===0n)
    throw Error("Family partner quote does not preserve a positive owned note.");
  const domain=Object.freeze({name:"Vanta Partner Quote",version:"2",
    chainId:resources.chainId,verifyingContract:getAddress(
      pin.modules.partnerRegistrar.address)});
  const message=Object.freeze({handleId:id,pool:getAddress(pin.pool),
    asset:getAddress(pin.assetAddress),payer:getAddress(request.payer),
    count:request.count,gross,protocolFeeCap,partnerFeeCap,
    outputsHash:hash(request.outputsHash,"outputs"),
    envelopesHash:hash(request.envelopesHash,"envelopes"),
    feeSlotsHash:hash(request.feeSlotsHash,"fee slots"),feeTermsHash,
    partnerRegistryRoot,signerSalt:salt,requestNonce:nonce,deadline});
  if(message.payer==="0x0000000000000000000000000000000000000000")
    throw Error("Family deposit payer is zero.");
  const signature=await signer.signTypedData(domain,
    FRESH_PARTNER_DEPOSIT_AUTH_TYPES,message);
  if(!isHexString(signature,65))
    throw Error("Family partner authorization signature is invalid.");
  return Object.freeze({handleId:id,signerSalt:toBeHex(salt,32),
    requestNonce:nonce,deadline,signature});
}

