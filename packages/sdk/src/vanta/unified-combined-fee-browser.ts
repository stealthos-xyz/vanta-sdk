/**
 * Single-proof V8 fee and registered-partner membership verification.
 * The caller invokes trusted, already-instantiated WASM inside the wallet.
 * No witness, viewing key, note opening or proving key is ever sent to HTTP.
 */
import { getAddress, isHexString, sha256 } from "ethers";

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MAX_PK_BYTES = 64 * 1024 * 1024;
const KEY_DIGEST = /^[0-9a-f]{64}$/i;

export type VantaV8CombinedFeeWasm = Readonly<{
  proveVantaV8UnifiedCombinedFeePartner(
    provingKey: Uint8Array,
    expectedSha256: string,
    walletWitness: unknown,
  ): string;
}>;

export type VantaV8CombinedFeeProof = Readonly<{
  schema: "vanta-v8-unified-combined-fee-partner-proof-v1";
  proof: string;
  public_signals: readonly string[];
  commitments: readonly string[];
  fee_terms_hash: string;
  verified_locally: true;
  research_only: true;
  safe_for_funds: false;
}>;

export type VantaV8CombinedProofExpectation = Readonly<{
  pool: string;
  asset: string;
  registry: string;
  mode: 0 | 1 | 2;
  width: 0 | 8 | 32;
  outputCount: number;
  /** Actual gross value for deposit (mode 2), zero for other modes. */
  depositGross?: bigint;
  outputCommitments: readonly bigint[];
  signedQuoteHash: string;
  partnerRegistryRoot: bigint;
  feeTermsHash: bigint;
  signedPartnerNonce: string;
  amountHash: bigint;
  batchDigest: bigint;
  feeLegIndex: number;
  /** Signed public payout for normal withdrawals, zero for other modes. */
  withdrawalPayout: bigint;
}>;

function parse(raw: string): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length > 8_000)
    throw Error("Invalid Vanta combined fee prover response.");
  try {
    const result: unknown = JSON.parse(raw);
    if (result && typeof result === "object" && !Array.isArray(result))
      return result as Record<string, unknown>;
  } catch { /* no wallet data is included in the error */ }
  throw Error("Invalid Vanta combined fee prover response.");
}

function field(value: unknown): bigint {
  if (typeof value !== "string" || !isHexString(value, 32))
    throw Error("Invalid combined fee public signal.");
  const parsed = BigInt(value);
  if (parsed >= FR) throw Error("Noncanonical combined fee public signal.");
  return parsed;
}

/**
 * Only return the 256-byte Groth16 proof after the wallet-local WASM has
 * verified all 37 public signals against the signed action quote.
 */
export function proveVantaV8CombinedFeePartnerInWallet(input: Readonly<{
  wasm: VantaV8CombinedFeeWasm;
  provingKey: Uint8Array;
  approvedKeySha256: string;
  walletWitness: unknown;
  expected: VantaV8CombinedProofExpectation;
}>): VantaV8CombinedFeeProof {
  const { wasm, provingKey, approvedKeySha256, walletWitness, expected } = input;
  if (typeof wasm?.proveVantaV8UnifiedCombinedFeePartner !== "function" ||
      !(provingKey instanceof Uint8Array) || !provingKey.length ||
      provingKey.length > MAX_PK_BYTES || !KEY_DIGEST.test(approvedKeySha256) ||
      sha256(provingKey).slice(2).toLowerCase() !== approvedKeySha256.toLowerCase())
    throw Error("Combined fee proving key is not trusted.");

  return validateVantaV8CombinedFeeProofResponse(
    wasm.proveVantaV8UnifiedCombinedFeePartner(
      provingKey, approvedKeySha256, walletWitness,
    ), expected,
  );
}

/** Validate the public transcript for BOTH conventional and STREAM_BOUND4
 * provers. STREAM_BOUND4 additionally verifies Groth16 inside wallet WASM. */
export function validateVantaV8CombinedFeeProofResponse(
  raw: string, expected: VantaV8CombinedProofExpectation,
): VantaV8CombinedFeeProof {
  const response = parse(raw);
  if (response.schema !== "vanta-v8-unified-combined-fee-partner-proof-v1" ||
      response.chain_id !== 84532 || response.verified_locally !== true ||
      response.research_only !== true || response.safe_for_funds !== false ||
      !isHexString(response.proof, 256) ||
      !Array.isArray(response.public_signals) ||
      response.public_signals.length !== 37 ||
      !Array.isArray(response.commitments) ||
      response.commitments.length !== 5 ||
      typeof response.fee_terms_hash !== "string" ||
      response.mode !== expected.mode || response.width !== expected.width ||
      response.output_count !== expected.outputCount)
    throw Error("Combined fee proof did not match the expected Vanta mode.");

  const signals = response.public_signals.map(field);
  const outputs = response.commitments.map(field);
  const pool = BigInt(getAddress(expected.pool));
  const asset = BigInt(getAddress(expected.asset));
  const registry = BigInt(getAddress(expected.registry));
  const nonce = BigInt(expected.signedPartnerNonce);
  const quoteField = BigInt(expected.signedQuoteHash);
  if (expected.outputCommitments.length !== 5 ||
      outputs.some((value, i) => value !== expected.outputCommitments[i]) ||
      signals.some((value, i) => i >= 20 && i < 25 && value !== outputs[i - 20]) ||
      signals[0] !== 84_532n || signals[1] !== pool ||
      signals[3] !== quoteField % FR ||
      signals[5] !== expected.feeTermsHash ||
      field(response.fee_terms_hash) !== expected.feeTermsHash ||
      signals[6] !== BigInt(expected.width) || signals[7] !== BigInt(expected.mode) ||
      signals[8] !== BigInt(expected.outputCount) ||
      signals[9] !== (expected.mode === 2 ? expected.depositGross : 0n) ||
      (expected.mode === 2 ?
        expected.depositGross === undefined || expected.depositGross <= 0n :
        expected.depositGross !== undefined && expected.depositGross !== 0n) ||
      signals[15] !== 0n ||
      signals[29] !== registry || signals[30] !== asset ||
      signals[31] !== expected.partnerRegistryRoot ||
      signals[32] !== nonce % FR ||
      signals[33] !== expected.amountHash ||
      signals[34] !== expected.batchDigest ||
      signals[35] !== BigInt(expected.feeLegIndex) ||
      signals[36] !== expected.withdrawalPayout ||
      (expected.mode === 0 ? expected.withdrawalPayout <= 0n : expected.withdrawalPayout !== 0n))
    throw Error("Combined fee proof is not bound to the signed action.");

  return {
    schema: "vanta-v8-unified-combined-fee-partner-proof-v1",
    proof: response.proof,
    public_signals: response.public_signals as string[],
    commitments: response.commitments as string[],
    fee_terms_hash: response.fee_terms_hash,
    verified_locally: true,
    research_only: true,
    safe_for_funds: false,
  };
}
