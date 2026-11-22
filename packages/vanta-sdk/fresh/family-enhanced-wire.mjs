import {encodeProofGates, G1, G2, VK, GATE0, GATE1, LINK, ROW} from './proof-gates.mjs';
/** Exact private funding wire shared by the wallet runtime and its local
 * qualification. No amount salt, wallet key or local request ID is encoded. */
import { AbiCoder, Interface, TypedDataEncoder, getAddress, keccak256, toUtf8Bytes } from "ethers";

export const ENHANCED_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const ENHANCED_MAX_AMOUNT = (1n << 120n) - 1n;
export const enhancedCoder = AbiCoder.defaultAbiCoder();
export const enhancedFail = () => { throw Error("Enhanced wallet state or proof binding is invalid."); };
export const enhancedWord = value => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) enhancedFail();
  return value;
};
export function enhancedField(value, zero = false) {
  const n = BigInt(value);
  if (n < (zero ? 0n : 1n) || n >= ENHANCED_FIELD) enhancedFail();
  return "0x" + n.toString(16).padStart(64, "0");
}
export function enhancedAmount(value, zero = false) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,36})$/u.test(value)) enhancedFail();
  const n = BigInt(value); if (n < (zero ? 0n : 1n) || n > ENHANCED_MAX_AMOUNT) enhancedFail(); return n;
}
export function enhancedRandomField() {
  for (let i = 0; i < 128; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(32)); bytes[0] &= 63;
    const value = BigInt("0x" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")); bytes.fill(0);
    if (value > 0n && value < ENHANCED_FIELD) return enhancedField(value);
  }
  enhancedFail();
}
export const enhancedClone = value => JSON.parse(JSON.stringify(value));
export const enhancedSame = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const enhancedAddress = value => getAddress(value).toLowerCase();
export const enhancedHashOutputs = outputs => keccak256(enhancedCoder.encode(["uint256[5]"], [outputs]));
export const enhancedHashEnvelopes = envelopes => keccak256(enhancedCoder.encode(["bytes32[5]"], [envelopes.map(keccak256)]));
export const enhancedHashNullifiers = (nullifiers, width) => keccak256(enhancedCoder.encode([`uint256[${width}]`], [nullifiers]));

export const ENHANCED_HEADER = "(uint8 width,uint64 sourceEpoch,uint256 sourceCheckpoint,uint64 targetEpoch,uint256 targetCheckpoint,uint256 reservationCommitment,uint256 authorizationDigest,uint256 amountHash,uint256 scopeDigest,uint256 feeTermsHash,uint256 partnerRegistryRoot,uint64 authorizationEpoch,bytes32 nonce,uint64 deadline,address relayer,bytes32 nullifiersHash,bytes32 outputsHash,bytes32 envelopesHash,uint8[3] feeSlots)";
export function enhancedFundingProofType(width) {
  if (![8, 32].includes(width)) enhancedFail();
  const action = `(address pool,address token,address recipient,address protocolFeeRecipient,address partnerFeeRecipient,uint64 sourceSlotCount,uint256 checkpointX,uint256 checkpointY,uint256 batchDigestField,uint256 feeQuoteDigestField,uint8 legIndex,uint8 feeLegIndex,uint8 legCount,uint128 protocolFeeCap,uint128 partnerFeeCap,uint256 saltedAmountHash,uint256[${width}] nullifiers,uint256[5] outputs)`;
  return `(${action} action,${GATE0} gate0,${GATE1} gate1,${LINK} link,${ROW}[5] rowKeys,bytes[5] encryptedOutputs,bytes feeProof,bytes authorizationProof)`;
}
export const enhancedPoolAbi = new Interface([
  `function authorizeEnhanced(${ENHANCED_HEADER},bytes,bytes)`,
  `function enhancedFundingDigest(${ENHANCED_HEADER}) view returns(bytes32)`,
  `function settlePublicBatch(${ENHANCED_HEADER},bytes,(address[] recipients,uint128[] amounts),bytes)`,
  "function publicBatchDigest(bytes32,uint8,(address[] recipients,uint128[] amounts)) view returns(uint256 digest,uint128 total)",
  "function executeEnhancedClaim((uint256 reservationRoot,uint256 spentNullifierRoot,uint256 nullifier,address recipient,uint128 amount,uint64 executionEpoch,bool recovery),bytes)",
  "function protocolFeeRecipient() view returns(address)", "function partnerFeeRecipient() view returns(address)",
  "function feeSigner() view returns(address)", "function feePolicyHash() view returns(bytes32)",
  "function activeGeneration() view returns(uint64 id,uint64 rows,uint256 checkpoint)",
  "function sourceSnapshot(uint64 id) view returns(uint64 rows,uint256 x,uint256 y,uint256 checkpoint,bool closed)",
  "function nullifierSpent(uint256) view returns(bool)", "function usedNonce(bytes32) view returns(bool)",
  "event CanonicalKzgRow(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment)",
  "event NullifierConsumed(uint256 indexed nullifier,uint8 indexed width)",
  "event EnhancedReservation(uint64 indexed index,uint256 commitment)",
  "event EnhancedClaimSettled(uint256 indexed nullifier,address indexed recipient,uint128 amount)",
  "event PublicBatchSettled(bytes32 indexed nonce,uint256 indexed digest,uint8 recipients,uint128 total)",
]);

export function enhancedPublicBatch(payments, pool) {
  if (!Array.isArray(payments) || payments.length < 2 || payments.length > 32) enhancedFail();
  const recipients = [], amounts = []; let total = 0n;
  for (const payment of payments) {
    if (!payment || Object.keys(payment).sort().join() !== "amountAtomic,recipient") enhancedFail();
    const recipient = enhancedAddress(payment.recipient), amount = enhancedAmount(payment.amountAtomic);
    if (recipient === "0x" + "00".repeat(20) || recipient === enhancedAddress(pool)) enhancedFail();
    recipients.push(recipient); amounts.push(amount.toString()); total += amount;
  }
  if (total > ENHANCED_MAX_AMOUNT) enhancedFail();
  return { batch: { recipients, amounts }, totalAtomic: total.toString() };
}
export function enhancedPublicBatchDigest({ domain, policyHash, nonce, width, batch }) {
  if (![8, 32].includes(width)) enhancedFail();
  return enhancedField(BigInt(keccak256(enhancedCoder.encode([
    "bytes32", "uint256", "uint256", "address", "address", "bytes32", "bytes32", "bytes32", "bytes32", "uint8", "address[]", "uint128[]",
  ], [keccak256(toUtf8Bytes("VANTA_V8_ATOMIC_PUBLIC_BATCH_V1")), domain.familyTag, domain.chainId, domain.pool,
    domain.asset, domain.genesisHash, domain.generationId, policyHash, nonce, width, batch.recipients, batch.amounts]))) % ENHANCED_FIELD);
}

export function enhancedFundingDigest(header, domain, policyHash) {
  return TypedDataEncoder.hash({ name: "StealthOS Vanta V8 PreAudit", version: "1", chainId: domain.chainId,
    verifyingContract: domain.pool }, { EnhancedEpochFunding: [
    { name: "generationId", type: "bytes32" }, { name: "genesisHash", type: "bytes32" },
    { name: "feePolicyHash", type: "bytes32" }, { name: "headerHash", type: "bytes32" },
  ] }, { generationId: domain.generationId, genesisHash: domain.genesisHash, feePolicyHash: policyHash,
    headerHash: keccak256(enhancedCoder.encode([ENHANCED_HEADER], [header])) });
}

export function enhancedGroth16Bytes(result, expected, role) {
  if (!result || result.role !== role || result.safeForFunds !== false || result.verified !== true ||
      !enhancedSame(result.publicSignals, expected) || !result.proof) enhancedFail();
  const { a, b, c } = result.proof;
  if (typeof result.proof === "string") {
    if (!/^0x[0-9a-f]{512}$/u.test(result.proof)) enhancedFail();
    return result.proof;
  }
  return enhancedCoder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [a, b, c]);
}

export function encodeEnhancedFundingProof({ domain, header, preview, bundle, rowKeys, envelopes,
  authorization, authorizationSignals, aggregate, publicPayoutAtomic, fee, feeSignals, protocolRecipient, partnerRecipient, signedDigest }) {
  const { gate0: g0, gate1: g1, cp_link: link } = bundle;
  if (bundle.safe_for_funds !== false || bundle.research_only !== true || bundle.chain_id !== domain.chainId ||
      bundle.family_tag !== domain.familyTag || bundle.source_epoch !== Number(header.sourceEpoch) ||
      BigInt(bundle.checkpoint_ref) !== BigInt(header.sourceCheckpoint) ||
      [g0, g1, link].some(p => p?.verified_locally !== true || p?.browser_generated !== true) ||
      g0.public_statement !== preview.public_statement || preview.width !== header.width ||
      enhancedHashOutputs(preview.output_commitments) !== header.outputsHash ||
      enhancedHashNullifiers(preview.nullifiers, header.width) !== header.nullifiersHash ||
      enhancedHashEnvelopes(envelopes) !== header.envelopesHash) enhancedFail();
  const publicInputs = [preview.public_statement, enhancedField(0, true), enhancedField(0, true),
    enhancedField(header.amountHash), domain.familyTag, enhancedField(domain.chainId)];
  const suppliedSignals = bundle.public_inputs ?? g0.public_inputs;
  if (!Array.isArray(suppliedSignals) || suppliedSignals.length !== 6 ||
      suppliedSignals.some((v, i) => BigInt(v) !== BigInt(publicInputs[i]))) enhancedFail();
  const proof = {
    action: { pool: domain.pool, token: domain.asset, recipient: domain.pool,
      protocolFeeRecipient: protocolRecipient, partnerFeeRecipient: partnerRecipient,
      sourceSlotCount: bundle.slot_count, checkpointX: g1.table.commitment.x, checkpointY: g1.table.commitment.y,
      batchDigestField: header.authorizationDigest, feeQuoteDigestField: BigInt(enhancedWord(signedDigest)) % ENHANCED_FIELD,
      legIndex: 0, feeLegIndex: 0, legCount: 1, protocolFeeCap: 0, partnerFeeCap: 0,
      saltedAmountHash: header.amountHash, nullifiers: preview.nullifiers, outputs: preview.output_commitments },
    ...encodeProofGates(g0, g1, link, publicInputs), rowKeys, encryptedOutputs: envelopes,
    feeProof: enhancedKzgFeeBytes(fee, feeSignals),
    authorizationProof: BigInt(header.reservationCommitment) === 0n
      ? encodeEnhancedPublicTotal({ aggregate, header, domain, totalAtomic: publicPayoutAtomic })
      : enhancedGroth16Bytes(authorization, authorizationSignals, "enhanced-authorization"),
  };
  return enhancedCoder.encode([enhancedFundingProofType(header.width)], [proof]);
}

function encodeEnhancedPublicTotal({ aggregate, header, domain, totalAtomic }) {
  const expected = [header.authorizationDigest, enhancedField(1), enhancedField(enhancedAmount(totalAtomic)), header.amountHash,
    ...Array(7).fill(enhancedField(0, true)), domain.familyTag, enhancedField(domain.chainId)];
  if (!aggregate || aggregate.safe_for_funds !== false || aggregate.verified_locally !== true ||
      aggregate.selected_proof_path !== "STREAM_BOUND4" || aggregate.relation !== "payout-aggregate" ||
      !enhancedSame(aggregate.public_signals, expected) || !/^0x[0-9a-f]{512}$/u.test(aggregate.proof)) enhancedFail();
  const [a, b, c] = enhancedCoder.decode([G1, G2, G1], aggregate.proof);
  return enhancedCoder.encode([VK, `(${G1} a,${G2} b,${G1} c)`, "uint256[11]"], [aggregate.vk, { a, b, c }, expected.slice(0, 11)]);
}

function enhancedKzgFeeBytes(result,expected){
  if(!result||result.relation!=="enhanced-fee-partner"||result.safe_for_funds!==false||result.verified_locally!==true||
    result.selected_proof_path!=="STREAM_BOUND4"||result.commitment_scheme!=="ccgroth16-policy-v1"||result.committed_witnesses!==1||
    expected.length!==41||!enhancedSame(result.public_signals,expected)||!/^0x[0-9a-f]{2176}$/u.test(result.proof))enhancedFail();
  return result.proof;
}
