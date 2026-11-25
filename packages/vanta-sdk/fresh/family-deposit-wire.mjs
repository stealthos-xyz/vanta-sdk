/** Current 40-input KZG deposit encoding. Protocol and relayer deposit fees
 * are zero; the partner fee is bound to the registered KZG policy. */
import {AbiCoder,Interface,keccak256,getAddress} from "ethers";
export const DEPOSIT_FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const depositWord=value=>{const n=BigInt(value);if(n<0n||n>=DEPOSIT_FIELD)throw Error("Invalid deposit field.");return "0x"+n.toString(16).padStart(64,"0");};
export const DEPOSIT_ZERO=depositWord(0),depositCoder=AbiCoder.defaultAbiCoder();
const QUOTE="(uint64 chainId,address pool,address asset,uint64 epoch,uint256 checkpoint,address payer,uint8 count,uint128 gross,uint128 protocolFeeCap,uint128 partnerFeeCap,address protocolRecipient,address partnerRecipient,bytes32 outputsHash,bytes32 envelopesHash,bytes32 feeSlotsHash,uint256 feeTermsHash,uint256 partnerRegistryRoot,bytes32 nonce,uint64 deadline,bytes32 feePolicyHash)";
const POINT="(uint256 x,uint256 y)",ROW="("+POINT+" a,"+POINT+" u,bytes32 aCompressed,bytes32 uCompressed,bytes32[16] siblings)";
export const FAMILY_DEPOSIT_ABI=Object.freeze([
 "function depositWithPrivateFeeNotes("+QUOTE+" q,uint256[5] outputs,bytes[5] encryptedOutputs,"+ROW+"[5] rowKeys,uint8[2] feeSlots,bytes combinedFeePartnerProof,bytes feeSignature) payable returns(uint256)",
 "function privateDepositQuoteDigest("+QUOTE+" q) view returns(bytes32)",
 "function currentSource() view returns(uint64 epoch,uint64 rows,uint256 x,uint256 y,uint256 checkpoint)",
 "function feeSigner() view returns(address)","function feePolicyHash() view returns(bytes32)",
 "function protocolFeeRecipient() view returns(address)","function partnerFeeRecipient() view returns(address)",
 "function combinedFeePartnerVerifier() view returns(address)","function asset() view returns(address)",
 "function usedNonce(bytes32) view returns(bool)",
 "function usedDepositNonce(bytes32) view returns(bool)"
]);
export const depositPoolAbi=new Interface(FAMILY_DEPOSIT_ABI);
export const depositAmount=value=>{if(typeof value!=="string"||!/^[1-9][0-9]{0,36}$/u.test(value)||BigInt(value)>((1n<<120n)-1n))throw Error("Invalid positive deposit amount.");return BigInt(value);};
export const depositTransactionDigest=tx=>keccak256(depositCoder.encode(
 ["uint256","address","address","uint256","bytes32"],[tx.chainId,getAddress(tx.from),getAddress(tx.to),tx.value,keccak256(tx.data)]));
let poseidonPromise;
export async function depositPoseidon(...values){poseidonPromise??=import("#vanta-circom-crypto").then(m=>m.buildPoseidon());
 const H=await poseidonPromise;return BigInt(H.F.toObject(H(values.map(BigInt))));}
export function depositPublicSignals({domain,quote,digest,outputs,tokenHash,protocolCommitment,registry,policyContext}){
 if(quote.count!==3||BigInt(quote.protocolFeeCap)!==0n||BigInt(quote.partnerFeeCap)<0n||
    BigInt(quote.partnerFeeCap)>=BigInt(quote.gross)||
    outputs.length!==5||outputs.slice(3).some(v=>BigInt(v)!==0n))throw Error("Deposit must preserve a positive owned note and zero protocol fee.");
 const s=Array(40).fill(0n);
 for(const [i,v] of [[0,domain.chainId],[1,domain.pool],[2,tokenHash],[3,BigInt(digest)%DEPOSIT_FIELD],
 [4,BigInt(quote.feePolicyHash)%DEPOSIT_FIELD],[5,quote.feeTermsHash],[7,2],[8,3],[9,quote.gross],[12,quote.partnerFeeCap],
 [14,protocolCommitment],[17,1],[18,2],[19,5],[29,registry],[30,domain.asset],
 [31,quote.partnerRegistryRoot],[32,BigInt(quote.nonce)%DEPOSIT_FIELD],[37,policyContext],[38,domain.familyTag],[39,domain.chainId]])s[i]=BigInt(v);
 outputs.forEach((v,i)=>{s[20+i]=BigInt(v);});return Object.freeze(s.map(depositWord));
}
export function assertFamilyDepositProof(proof,expected){
 if(expected.length!==40||!proof||proof.relation!=="combined-fee-partner"||
   proof.safe_for_funds!==false||proof.verified_locally!==true||proof.selected_proof_path!=="STREAM_BOUND4"||
   proof.commitment_scheme!=="ccgroth16-policy-v1"||proof.committed_witnesses!==1||
   !Array.isArray(proof.public_signals)||proof.public_signals.length!==40||
   proof.public_signals.some((v,i)=>BigInt(v)!==BigInt(expected[i]))||
   !/^0x[0-9a-f]{2176}$/u.test(proof.proof))throw Error("Current KZG deposit proof differs from its exact 40-input statement.");
 return proof.proof;
}
export async function depositFeeTerms({domain,feePolicyHash,tokenHash,protocolRoute,partnerRoute,outputs,blinding,partnerFee=0n}){
 const values=[domain.chainId,domain.pool,tokenHash,BigInt(feePolicyHash)%DEPOSIT_FIELD,0,2,3,0,
  0,partnerFee,0,protocolRoute.collectorMpk,partnerRoute.collectorMpk,0,1,2,5,...outputs,0,0,0,blinding];
 let h=0x5638465445520001n;for(let i=0;i<values.length;i+=2)h=await depositPoseidon(h,values[i],values[i+1]??0);
 return depositWord(h);
}

/** Select the nonce registry from authenticated deployment resource metadata.
 * Legacy signed inventories omit the mode; new pools must pin isolated-v2.
 * Never infer the registry from RPC failures or try a fallback after a revert. */
export function directDepositNonceMethod(deployment){
 if(deployment?.depositNonceMode==="isolated-v2")return "usedDepositNonce";
 if(deployment&& !Object.hasOwn(deployment,"depositNonceMode"))return "usedNonce";
 throw Error("Unsupported direct deposit nonce registry");
}
