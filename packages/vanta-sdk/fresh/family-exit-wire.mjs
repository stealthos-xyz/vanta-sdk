/** Current family KZG no-append exits. Public metadata only; never an older
 * transaction engine or a relayer-supplied key/deployment manifest. */
import {Interface,TypedDataEncoder,keccak256,toUtf8Bytes,ZeroAddress} from 'ethers';
import {enhancedCoder as coder,enhancedField as field,ENHANCED_FIELD as FR,enhancedFail as fail,
 enhancedHashOutputs,enhancedHashNullifiers} from './family-enhanced-wire.mjs';
const G1='(uint256 x,uint256 y)',G2='(uint256 xIm,uint256 xRe,uint256 yIm,uint256 yRe)',
 VK=`(${G1} alpha,${G2} beta,${G2} gamma,${G2} delta,${G1}[] ic)`,
 G0=`(${VK} vk,(${G1} a,${G2} b,${G1} c,${G1} d) proof,uint256[6] publicInputs)`,
 GATE1=`((uint256 n,${G1} commitment,${G1} zH,${G1} query) table,(${G1} g1,${G2} g20,${G2} g21) srs,(${G1} zI,${G1} cI,${G1} u,${G2} w,${G1} h,uint256 v1,uint256 v2,${G1} pi1,${G1} pi2,${G1} pi3) proof,bytes context)`,
 LINK=`(${G1} pi,${G2} a2,${G2} c1,${G2} c2)`;
const specs=[['chainId','uint64'],['pool','address'],['asset','address'],['width','uint8'],['sourceEpoch','uint64'],
 ['sourceCheckpoint','uint256'],['recipient','address'],['payout','uint128'],['protocolFee','uint128'],['partnerFee','uint128'],
 ['protocolFeeCap','uint128'],['partnerFeeCap','uint128'],['protocolRecipient','address'],['partnerRecipient','address'],['relayer','address'],
 ['nullifiersHash','bytes32'],['outputsHash','bytes32'],['saltedAmountHash','uint256'],['nonce','bytes32'],['deadline','uint64'],['feePolicyHash','bytes32']];
export const FAMILY_EXIT_QUOTE='('+specs.map(([n,t])=>t+' '+n).join(',')+')';
const proofType=w=>`((address pool,address token,address recipient,address protocolFeeRecipient,address partnerFeeRecipient,uint64 sourceSlotCount,uint256 checkpointX,uint256 checkpointY,uint256 batchDigestField,uint256 feeQuoteDigestField,uint8 legIndex,uint8 feeLegIndex,uint8 legCount,uint128 protocolFeeCap,uint128 partnerFeeCap,uint256 saltedAmountHash,uint256[${w}] nullifiers,uint256[5] outputs) action,${G0} gate0,${GATE1} gate1,${LINK} link,${VK} aggregateVk,(${G1} a,${G2} b,${G1} c) aggregateProof,uint256[11] aggregateInputs)`;
export const familyExitAbi=new Interface([
 ...[8,32].map(w=>`function settleNoAppendExit${w}(${FAMILY_EXIT_QUOTE},${proofType(w)},bytes)`),
 `function exitQuoteDigest(${FAMILY_EXIT_QUOTE}) view returns(bytes32)`,
 'function sourceSnapshot(uint64) view returns(uint64 rows,uint256 x,uint256 y,uint256 checkpoint,bool closed)',
 'function feePolicyHash() view returns(bytes32)','function exitFeePolicyHash() view returns(bytes32)',
 'function minimumProtocolFee() view returns(uint128)','function fixedPartnerExitFee() view returns(uint128)',
 'function exitProtocolFeeBps() view returns(uint16)','function exitPartnerFeeBps() view returns(uint16)',
 'function protocolFeeRecipient() view returns(address)','function partnerFeeRecipient() view returns(address)',
 'function nullifierSpent(uint256) view returns(bool)','function usedNonce(bytes32) view returns(bool)',
 'event PreAuditFullExit(bytes32 indexed quoteNonce,uint64 indexed sourceEpoch,address indexed recipient,uint8 width,uint256 payout,uint256 protocolFee,uint256 partnerFee,uint256 sourceCheckpoint)',
 'event NullifierConsumed(uint256 indexed nullifier,uint8 indexed width)']);
export function familyExitBatchField(q){return field(BigInt(keccak256(coder.encode(
 ['bytes32','uint64','address','uint8','uint64','uint256','bytes32'],
 [keccak256(toUtf8Bytes('STEALTHOS_VANTA_V8_NO_APPEND_EXIT_BATCH_V1')),q.chainId,q.pool,q.width,q.sourceEpoch,q.sourceCheckpoint,q.nonce])))%FR);}
export function familyExitDigest(q){return TypedDataEncoder.hash({name:'StealthOS Vanta V8 PreAudit',version:'1',chainId:q.chainId,verifyingContract:q.pool},
 {NoAppendExitQuote:specs.map(([name,type])=>({name,type}))},q);}
export function encodeFamilyExit({domain,q,preview,bundle,aggregate,source}){
 const {gate0:g0,gate1:g1,cp_link:link}=bundle??{},batch=familyExitBatchField(q),quoteField=field(BigInt(familyExitDigest(q))%FR);
 if(q.pool!==domain.pool||q.asset!==domain.asset||BigInt(q.chainId)!==BigInt(domain.chainId)||q.relayer!==ZeroAddress||
  q.protocolFee!==q.protocolFeeCap||q.partnerFee!==q.partnerFeeCap||bundle.safe_for_funds!==false||bundle.research_only!==true||
  bundle.chain_id!==domain.chainId||bundle.family_tag!==domain.familyTag||bundle.source_epoch!==q.sourceEpoch||
  BigInt(bundle.checkpoint_ref)!==BigInt(q.sourceCheckpoint)||bundle.slot_count!==source.rows||
  [g0,g1,link].some(v=>v?.verified_locally!==true||v?.browser_generated!==true)||
  g0.public_statement!==preview.public_statement||preview.width!==q.width||
  enhancedHashNullifiers(preview.nullifiers,q.width)!==q.nullifiersHash||enhancedHashOutputs(preview.output_commitments)!==q.outputsHash||
  BigInt(g1.table.commitment.x)!==BigInt(source.x)||BigInt(g1.table.commitment.y)!==BigInt(source.y))fail();
 const signals=[preview.public_statement,field(q.protocolFee,true),field(q.partnerFee,true),field(q.saltedAmountHash),domain.familyTag,field(q.chainId)];
 const supplied=bundle.public_inputs??g0.public_inputs;
 if(!Array.isArray(supplied)||supplied.length!==6||supplied.some((v,i)=>BigInt(v)!==BigInt(signals[i])))fail();
 const expected=[batch,field(1),field(q.payout),field(q.saltedAmountHash),...Array(7).fill(field(0,true)),domain.familyTag,field(q.chainId)];
 if(!aggregate||aggregate.relation!=='payout-aggregate'||aggregate.safe_for_funds!==false||aggregate.verified_locally!==true||
  aggregate.selected_proof_path!=='STREAM_BOUND4'||!Array.isArray(aggregate.public_signals)||aggregate.public_signals.length!==13||
  aggregate.public_signals.some((v,i)=>BigInt(v)!==BigInt(expected[i]))||!/^0x[0-9a-f]{512}$/u.test(aggregate.proof))fail();
 const [a,b,c]=coder.decode([G1,G2,G1],aggregate.proof);
 const proof={action:{pool:q.pool,token:q.asset,recipient:q.recipient,protocolFeeRecipient:q.protocolRecipient,partnerFeeRecipient:q.partnerRecipient,
  sourceSlotCount:source.rows,checkpointX:source.x,checkpointY:source.y,batchDigestField:batch,feeQuoteDigestField:quoteField,
  legIndex:0,feeLegIndex:0,legCount:1,protocolFeeCap:q.protocolFeeCap,partnerFeeCap:q.partnerFeeCap,saltedAmountHash:q.saltedAmountHash,
  nullifiers:preview.nullifiers,outputs:preview.output_commitments},
  gate0:{vk:{alpha:g0.vk.alpha_g1,beta:g0.vk.beta_g2,gamma:g0.vk.gamma_g2,delta:g0.vk.delta_g2,ic:g0.vk.gamma_abc_g1},proof:{a:g0.a,b:g0.b,c:g0.c,d:g0.d},publicInputs:signals},
  gate1:{table:{n:g1.table.n,commitment:g1.table.commitment,zH:g1.table.z_h_g1,query:g1.query},srs:{g1:g1.srs.g1[0],g20:g1.srs.g2[0],g21:g1.srs.g2[1]},
   proof:{zI:g1.proof.z_i,cI:g1.proof.c_i,u:g1.proof.u,w:g1.proof.w,h:g1.proof.h,v1:g1.proof.v1,v2:g1.proof.v2,pi1:g1.proof.pi1,pi2:g1.proof.pi2,pi3:g1.proof.pi3},context:g1.transcript_context_hex},
  link:{pi:link.pi,a2:link.a2,c1:link.c1,c2:link.c2},aggregateVk:aggregate.vk,aggregateProof:{a,b,c},aggregateInputs:expected.slice(0,11)};
 return familyExitAbi.encodeFunctionData('settleNoAppendExit'+q.width,[q,proof,'0x']);
}
