/** Family-bound normal private sends. All six Gate0 and forty KZG fee
 * signals remain bound to the same quote, outputs and source checkpoint. */
import {Interface,TypedDataEncoder,keccak256,toUtf8Bytes,ZeroAddress} from 'ethers';
import {enhancedCoder as coder,enhancedField as field,ENHANCED_FIELD as FR,
 enhancedHashOutputs,enhancedHashNullifiers,enhancedHashEnvelopes} from './family-enhanced-wire.mjs';
const G1='(uint256 x,uint256 y)',G2='(uint256 xIm,uint256 xRe,uint256 yIm,uint256 yRe)',
 VK=`(${G1} alpha,${G2} beta,${G2} gamma,${G2} delta,${G1}[] ic)`,
 G0=`(${VK} vk,(${G1} a,${G2} b,${G1} c,${G1} d) proof,uint256[6] publicInputs)`,
 GATE1=`((uint256 n,${G1} commitment,${G1} zH,${G1} query) table,(${G1} g1,${G2} g20,${G2} g21) srs,(${G1} zI,${G1} cI,${G1} u,${G2} w,${G1} h,uint256 v1,uint256 v2,${G1} pi1,${G1} pi2,${G1} pi3) proof,bytes context)`,
 LINK=`(${G1} pi,${G2} a2,${G2} c1,${G2} c2)`,
 ROW=`(${G1} a,${G1} u,bytes32 aCompressed,bytes32 uCompressed,bytes32[16] siblings)`;
export const FAMILY_NORMAL_FIELDS=Object.freeze([['chainId','uint64'],['pool','address'],['asset','address'],['width','uint8'],['mode','uint8'],
 ['sourceEpoch','uint64'],['sourceCheckpoint','uint256'],['targetEpoch','uint64'],['targetCheckpoint','uint256'],
 ['recipient','address'],['payout','uint128'],['protocolFeeCap','uint128'],['partnerFeeCap','uint128'],['relayerFeeCap','uint128'],
 ['protocolRecipient','address'],['partnerRecipient','address'],['relayer','address'],['nullifiersHash','bytes32'],['outputsHash','bytes32'],
 ['envelopesHash','bytes32'],['saltedAmountHash','uint256'],['feeSlotsHash','bytes32'],['feeTermsHash','uint256'],['partnerRegistryRoot','uint256'],
 ['nonce','bytes32'],['deadline','uint64'],['feePolicyHash','bytes32']].map(([name,type])=>Object.freeze({name,type})));
export const FAMILY_NORMAL_QUOTE='('+FAMILY_NORMAL_FIELDS.map(({name,type})=>type+' '+name).join(',')+')';
export const familyNormalProofType=w=>`((address pool,address token,address recipient,address protocolFeeRecipient,address partnerFeeRecipient,uint64 sourceSlotCount,uint256 checkpointX,uint256 checkpointY,uint256 batchDigestField,uint256 feeQuoteDigestField,uint8 legIndex,uint8 feeLegIndex,uint8 legCount,uint128 protocolFeeCap,uint128 partnerFeeCap,uint256 saltedAmountHash,uint256[${w}] nullifiers,uint256[5] outputs) action,${G0} gate0,${GATE1} gate1,${LINK} link,${VK} aggregateVk,(${G1} a,${G2} b,${G1} c) aggregateProof,uint256[11] aggregateInputs,${ROW}[5] rowKeys,bytes[5] encryptedOutputs,uint8[3] feeSlots,bytes combinedFeePartnerProof)`;
export const familyNormalAbi=new Interface([
 ...[8,32].map(w=>`function settleNormalEpoch${w}(${FAMILY_NORMAL_QUOTE},${familyNormalProofType(w)},bytes)`),
 `function normalQuoteDigest(${FAMILY_NORMAL_QUOTE}) view returns(bytes32)`,
 `function normalDigestFields(${FAMILY_NORMAL_QUOTE}) view returns(uint256 quoteField,uint256 batchField)`,
 'function activeGeneration() view returns(uint64 id,uint64 rows,uint256 checkpoint)',
 'function sourceSnapshot(uint64) view returns(uint64 rows,uint256 x,uint256 y,uint256 checkpoint,bool closed)',
 'function feeSigner() view returns(address)','function protocolFeeRecipient() view returns(address)',
 'function partnerFeeRecipient() view returns(address)','function combinedFeePartnerVerifier() view returns(address)',
 'function minimumProtocolFee() view returns(uint128)','function usedNonce(bytes32) view returns(bool)',
 'function nullifierSpent(uint256) view returns(bool)',
 'event PreAuditNormalSettlement(bytes32 indexed quoteNonce,uint64 indexed sourceEpoch,uint64 indexed targetEpoch,uint8 width,uint8 mode,uint128 payout,uint256 targetCheckpoint)']);
const fail=()=>{throw Error('Private transfer proof, quote or deployment binding differs.');};
export const familyNormalDigest=q=>TypedDataEncoder.hash({name:'StealthOS Vanta V8 PreAudit',version:'1',chainId:q.chainId,verifyingContract:q.pool},
 {NormalEpochQuote:FAMILY_NORMAL_FIELDS},q);
export const familyNormalBatchField=q=>field(BigInt(keccak256(coder.encode(
 ['bytes32','uint64','address','uint8','uint8','uint64','uint256','uint64','uint256','bytes32'],
 [keccak256(toUtf8Bytes('STEALTHOS_VANTA_V8_NORMAL_EPOCH_BATCH_V1')),q.chainId,q.pool,q.width,q.mode,q.sourceEpoch,q.sourceCheckpoint,q.targetEpoch,q.targetCheckpoint,q.nonce])))%FR);
export function familyNormalFeeSignals({domain,q,outputs,protocolCollectorCommitment,relayerCollectorCommitment,protocolBps,policyContext}){
 if(outputs.length!==5||(q.mode===1?(q.recipient!==ZeroAddress||BigInt(q.payout)!==0n):q.mode!==0||q.recipient===ZeroAddress||BigInt(q.payout)<=0n))fail();
 return normalFeeSignals({domain,q,outputs,protocolCollectorCommitment,relayerCollectorCommitment,protocolBps,policyContext});
}
export function familyRoutedFeeSignals(input){
 const {q,outputs}=input;if(![4,5].includes(q.mode)||q.recipient===ZeroAddress||BigInt(q.payout)<=0n||outputs.length!==5)fail();
 return normalFeeSignals({...input,protocolBps:0});
}
function normalFeeSignals({domain,q,outputs,protocolCollectorCommitment,relayerCollectorCommitment,protocolBps,policyContext}){
 const transfer=q.mode===1;
 const values=[q.chainId,q.pool,domain.tokenHash,BigInt(familyNormalDigest(q))%FR,BigInt(q.feePolicyHash)%FR,q.feeTermsHash,q.width,q.mode,5,0,
  domain.minimumProtocolFee,q.protocolFeeCap,q.partnerFeeCap,q.relayerFeeCap,protocolCollectorCommitment,0,relayerCollectorCommitment,1,2,3,
  ...outputs,transfer?protocolBps:0,transfer?q.saltedAmountHash:0,transfer?familyNormalBatchField(q):0,0,domain.registry,domain.asset,q.partnerRegistryRoot,BigInt(q.nonce)%FR,
  q.saltedAmountHash,familyNormalBatchField(q),0,q.mode===0?q.payout:0,policyContext,domain.familyTag,q.chainId];
 if(values.length!==40)fail();return Object.freeze(values.map(v=>field(v,true)));
}
export const encodeFamilyPrivateSend=input=>encodeFamilyNormalSpend(input,false);
export const encodeFamilyRoutedSpend=input=>encodeFamilyNormalSpend(input,true);
function encodeFamilyNormalSpend({domain,q,signature,preview,bundle,combined,aggregate,source,rowKeys,envelopes,expectedFeeSignals},routed){
 const g0=bundle?.gate0,g1=bundle?.gate1,link=bundle?.cp_link,batch=familyNormalBatchField(q),quote=field(BigInt(familyNormalDigest(q))%FR);
 if((routed?(![4,5].includes(q.mode)||q.recipient===ZeroAddress||BigInt(q.payout)<=0n):(q.mode===1?(q.recipient!==ZeroAddress||BigInt(q.payout)!==0n):q.mode!==0||q.recipient===ZeroAddress||BigInt(q.payout)<=0n))||q.pool!==domain.pool||q.asset!==domain.asset||Number(q.chainId)!==domain.chainId||
  ![8,32].includes(q.width)||!/^0x[0-9a-f]{130}$/iu.test(signature)||bundle?.safe_for_funds!==false||bundle.research_only!==true||
  bundle.chain_id!==domain.chainId||bundle.family_tag!==domain.familyTag||bundle.source_epoch!==q.sourceEpoch||
  BigInt(bundle.checkpoint_ref)!==BigInt(q.sourceCheckpoint)||bundle.slot_count!==source.rows||
  [g0,g1,link].some(v=>v?.verified_locally!==true||v?.browser_generated!==true)||g0.public_statement!==preview.public_statement||preview.width!==q.width||
  enhancedHashNullifiers(preview.nullifiers,q.width)!==q.nullifiersHash||enhancedHashOutputs(preview.output_commitments)!==q.outputsHash||
  enhancedHashEnvelopes(envelopes)!==q.envelopesHash||q.feeSlotsHash!==keccak256(coder.encode(['uint8[3]'],[[1,2,3]]))||
  !Array.isArray(rowKeys)||rowKeys.length!==5||!Array.isArray(envelopes)||envelopes.length!==5||
  BigInt(g1.table.commitment.x)!==BigInt(source.x)||BigInt(g1.table.commitment.y)!==BigInt(source.y))fail();
 const signals=[preview.public_statement,field(q.protocolFeeCap,true),field(q.partnerFeeCap,true),field(q.saltedAmountHash),domain.familyTag,field(q.chainId)],supplied=bundle.public_inputs??g0.public_inputs;
 if(!Array.isArray(supplied)||supplied.length!==6||supplied.some((v,i)=>BigInt(v)!==BigInt(signals[i]))||
  combined?.relation!=='combined-fee-partner'||combined.verified_locally!==true||combined.safe_for_funds!==false||combined.selected_proof_path!=='STREAM_BOUND4'||
  combined.commitment_scheme!=='ccgroth16-policy-v1'||combined.committed_witnesses!==1||
  !Array.isArray(expectedFeeSignals)||expectedFeeSignals.length!==40||!Array.isArray(combined.public_signals)||combined.public_signals.length!==40||
  combined.public_signals.some((v,i)=>BigInt(v)!==BigInt(expectedFeeSignals[i]))||!/^0x[0-9a-f]{2176}$/u.test(combined.proof))fail();
 const zero={x:0,y:0},zero2={xIm:0,xRe:0,yIm:0,yRe:0};
 const proof={action:{pool:q.pool,token:q.asset,recipient:q.recipient,protocolFeeRecipient:q.protocolRecipient,partnerFeeRecipient:q.partnerRecipient,
  sourceSlotCount:source.rows,checkpointX:source.x,checkpointY:source.y,batchDigestField:batch,feeQuoteDigestField:quote,legIndex:0,feeLegIndex:0,legCount:1,
  protocolFeeCap:q.protocolFeeCap,partnerFeeCap:q.partnerFeeCap,saltedAmountHash:q.saltedAmountHash,nullifiers:preview.nullifiers,outputs:preview.output_commitments},
  gate0:{vk:{alpha:g0.vk.alpha_g1,beta:g0.vk.beta_g2,gamma:g0.vk.gamma_g2,delta:g0.vk.delta_g2,ic:g0.vk.gamma_abc_g1},proof:{a:g0.a,b:g0.b,c:g0.c,d:g0.d},publicInputs:signals},
  gate1:{table:{n:g1.table.n,commitment:g1.table.commitment,zH:g1.table.z_h_g1,query:g1.query},srs:{g1:g1.srs.g1[0],g20:g1.srs.g2[0],g21:g1.srs.g2[1]},
   proof:{zI:g1.proof.z_i,cI:g1.proof.c_i,u:g1.proof.u,w:g1.proof.w,h:g1.proof.h,v1:g1.proof.v1,v2:g1.proof.v2,pi1:g1.proof.pi1,pi2:g1.proof.pi2,pi3:g1.proof.pi3},context:g1.transcript_context_hex},
  link:{pi:link.pi,a2:link.a2,c1:link.c1,c2:link.c2},aggregateVk:{alpha:zero,beta:zero2,gamma:zero2,delta:zero2,ic:[]},aggregateProof:{a:zero,b:zero2,c:zero},aggregateInputs:Array(11).fill(0),
  rowKeys,encryptedOutputs:envelopes,feeSlots:[1,2,3],combinedFeePartnerProof:combined.proof};
 if(routed){
  const expected=[batch,field(1),field(q.payout),field(q.saltedAmountHash),...Array(7).fill(field(0,true)),domain.familyTag,field(q.chainId)];
  if(aggregate?.relation!=='payout-aggregate'||aggregate.safe_for_funds!==false||aggregate.verified_locally!==true||aggregate.selected_proof_path!=='STREAM_BOUND4'||
   !Array.isArray(aggregate.public_signals)||aggregate.public_signals.length!==13||aggregate.public_signals.some((v,i)=>BigInt(v)!==BigInt(expected[i]))||
   !/^0x[0-9a-f]{512}$/u.test(aggregate.proof))fail();
  const [a,b,c]=coder.decode([G1,G2,G1],aggregate.proof);proof.aggregateVk=aggregate.vk;proof.aggregateProof={a,b,c};proof.aggregateInputs=expected.slice(0,11);
 }
 return familyNormalAbi.encodeFunctionData('settleNormalEpoch'+q.width,[q,proof,signature]);
}
