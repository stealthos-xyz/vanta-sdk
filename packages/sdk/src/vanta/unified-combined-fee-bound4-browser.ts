/**
 * Same-origin STREAM_BOUND4 execution for fee and payout relations. KZG fee
 * keys commit one private policy leaf and compose the existing Caulk+/CP_link.
 * Reuses Vanta's four existing V8 MSM shard WebWorkers and unchanged fee rules.
 *
 * The main wallet worker retains bounded R1CS assignments; MSM chunks are transferred only
 * to the four same-origin wallet shard workers. Never send them over HTTP.
 */
import { isHexString, sha256 } from "ethers";
import {selectVantaFamilyBound4Driver, type VantaFamilyBound4Descriptor}
  from "./family-bound4-domain.js";
import type {VantaV8CombinedFeeProof, VantaV8CombinedProofExpectation}
  from "./unified-combined-fee-browser.js";

const SECTIONS = ["H", "L", "A", "B_G1", "B_G2"] as const;
type Section = typeof SECTIONS[number];
const MAX_POINTS = 65_536;
const MAX_CHUNK_POINTS = 512;
const HASH = /^[0-9a-f]{64}$/i;

type MsmChunk = Readonly<{
  offset: number;
  length: number;
  point_start: number;
  point_count: number;
  sha256: string;
}>;
type MsmSection = Readonly<{
  id: Section;
  curve: "G1" | "G2";
  point_count: number;
  bytes: number;
  chunks: readonly MsmChunk[];
}>;
export type VantaCombinedBound4KeyManifest = Readonly<{
  schema: "vanta-v8-combined-bound4-key-v1";
  research_only: true;
  chain_id: number;
  public_signals: number;
  qap_domain: number;
  selected_proof_path?: "STREAM_BOUND4";
  relation?: "payout-aggregate" | "combined-fee-partner" | "enhanced-fee-partner";
  family_tag?: string;
  r1cs_sha256?: string;
  commitment_scheme?: "groth16" | "ccgroth16-policy-v1";
  committed_witnesses?: 0 | 1;
  pk_sha256: string;
  fixed_sha256: string;
  fixed_bytes: number;
  section_count: 5;
  msm_chunk_points: 512;
  sections: readonly MsmSection[];
}>;

export type VantaCombinedBound4MatrixManifest = Readonly<{
  schema: "vanta-v8-combined-bound4-offline-matrix-v1";
  chain_id: number;
  format_version: 2;
  constraints: number;
  instance_variables: number;
  selected_proof_path?: "STREAM_BOUND4";
  relation?: "payout-aggregate" | "combined-fee-partner" | "enhanced-fee-partner";
  family_tag?: string;
  r1cs_sha256?: string;
  commitment_scheme?: "groth16" | "ccgroth16-policy-v1";
  committed_witnesses?: 0 | 1;
  witness_variables: number;
  qap_domain_size: number;
  dictionary_bytes: number;
  dictionary_sha256: string;
  file_bytes: number;
  file_sha256: string;
  blocks: readonly Readonly<{
    matrix_id: number;
    label: "A" | "B" | "C";
    row_start: number;
    row_count: number;
    offset: number;
    length: number;
    sha256: string;
  }>[];
}>;

export type VantaStandardBound4Prover = {
  loadFixed(bytes: Uint8Array, sha: string): void;
  loadPolicyLookupKey?(bytes: Uint8Array, sha: string): void;
  beginBound4(witness: unknown): Map<string, unknown>;
  loadMatrixDictionary(bytes: Uint8Array, sha: string): void;
  beginOfflineBound4(witness: unknown): Map<string, unknown>;
  applyMatrixBlock(id: number, rowStart: number, rows: number, bytes: Uint8Array): void;
  finishAB(): void;
  finishC(): void;
  scalarChunk(section: string, start: number, count: number): Uint8Array;
  finishBound4(h: Uint8Array, l: Uint8Array, a: Uint8Array,
    bg1: Uint8Array, bg2: Uint8Array): Map<string, unknown>;
  abortBound4(): void;
  free(): void;
};
export type VantaCombinedBound4Wasm = Readonly<{
  VantaCombinedBound4Prover: {
    new (): VantaStandardBound4Prover;
    newAggregate?(): VantaStandardBound4Prover;
    newEnhanced?(): VantaStandardBound4Prover;
  };
  VantaM2MsmShard: { totalWindows(bits: number): number };
  vantaM2SignedDigits(scalars: Uint8Array, windowBits: number): Int16Array;
  vantaM2CombineG1(parts: Uint8Array, count: number): Uint8Array;
  vantaM2CombineG2(parts: Uint8Array, count: number): Uint8Array;
}>;

/** Compatible with the already existing v8Bound4ShardWorker.ts protocol. */
export type VantaBound4ShardWorker = {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  addEventListener(type: "message" | "error", cb: (e: any) => void): void;
  removeEventListener(type: "message" | "error", cb: (e: any) => void): void;
  terminate(): void;
};

export class Shard {
  private seq = 0;
  private stopped = false;
  private pending = new Set<(error: Error) => void>();
  constructor(readonly worker: VantaBound4ShardWorker, readonly signal?: AbortSignal) {}
  call<T = unknown>(type: string, args: object, transfer: ArrayBuffer[] = []): Promise<T> {
    if (this.stopped || this.signal?.aborted) return Promise.reject(Error("Vanta proof cancelled or worker terminated"));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.pending.delete(cancel);
        this.worker.removeEventListener("message", msg);
        this.worker.removeEventListener("error", fail);
        this.signal?.removeEventListener("abort", abort);
      };
      const settle = (value?: T, error?: Error) => {
        if (done) return;
        done = true;
        cleanup();
        if (error) reject(error);
        else resolve(value as T);
      };
      const msg = (e: { data: {id: number; type: string; result?: T} }) => {
        if (e.data?.id !== id) return;
        if (e.data.type === "error") settle(undefined, Error("Vanta MSM worker rejected a chunk"));
        else if (e.data.type === "success") settle(e.data.result);
        else settle(undefined, Error("Vanta MSM worker reply is malformed"));
      };
      const fail = (event: {error?: Error}) => {
          const cause = event.error?.message;
          settle(undefined, Error(cause === "Vanta worker memory exhausted" || cause === "Vanta worker bootstrap failed"
            ? cause : "Vanta MSM worker failed"));
        };
      const abort = () => settle(undefined, Error("Vanta proof cancelled"));
      const cancel = (error: Error) => settle(undefined, error);
      this.pending.add(cancel);
      timer = setTimeout(() => cancel(Error("Vanta MSM worker response timed out")), 120_000);
      this.worker.addEventListener("message", msg);
      this.worker.addEventListener("error", fail);
      this.signal?.addEventListener("abort", abort, { once: true });
      try {this.worker.postMessage({ id, type, ...args }, transfer);}
      catch {settle(undefined, Error("Vanta MSM worker request failed"));}
    });
  }
  terminate() {
    if (this.stopped) return;
    this.stopped = true;
    for (const cancel of this.pending) cancel(Error("Vanta MSM worker terminated"));
    this.worker.terminate();
  }
}

// Keep startup memory bounded on mobile. Once initialized all four independent
// workers process their assigned MSM windows in parallel.
export async function initializeBound4Shards(shards: Shard[], create: () => VantaBound4ShardWorker,
  width: number, signal?: AbortSignal) {
  for (let i = 0; i < 4; ++i) {
    signal?.throwIfAborted();
    const worker = create();
    if (shards.some(shard => shard.worker === worker))
      throw Error("Vanta BOUND4 requires four distinct local workers");
    const shard = new Shard(worker, signal);
    shards.push(shard);
    if (await shard.call("init", {width}) !== true)
      throw Error("Vanta BOUND4 worker initialization rejected");
  }
}

type RelationProfile = Readonly<{chainId: number; publicSignals: number;
  constraints: number; domain: number; witnesses?: number; familyTag?: string;
  committedWitnesses?: 0 | 1;
  relation: "payout-aggregate" | "combined-fee-partner" | "enhanced-fee-partner"}>;
const LEGACY_COMBINED: RelationProfile = {chainId: 84532, publicSignals: 37,
  constraints: 53_442, domain: 65_536, relation: "combined-fee-partner"};
function validateManifest(m: VantaCombinedBound4KeyManifest, approvedKey: string,
  profile: RelationProfile): void {
  if (m?.schema !== "vanta-v8-combined-bound4-key-v1" ||
      m.research_only !== true || m.chain_id !== profile.chainId ||
      m.public_signals !== profile.publicSignals || m.qap_domain !== profile.domain ||
      (profile.familyTag !== undefined && (m.selected_proof_path !== "STREAM_BOUND4" ||
        m.relation !== profile.relation || m.family_tag !== profile.familyTag ||
        !HASH.test(m.r1cs_sha256 ?? ""))) ||
      (profile.committedWitnesses === 1 &&
        (m.commitment_scheme !== "ccgroth16-policy-v1" || m.committed_witnesses !== 1)) ||
      m.section_count !== 5 || m.msm_chunk_points !== 512 ||
      !HASH.test(m.pk_sha256) || !HASH.test(m.fixed_sha256) ||
      m.pk_sha256.toLowerCase() !== approvedKey.toLowerCase() ||
      !Number.isSafeInteger(m.fixed_bytes) || m.fixed_bytes < 1 ||
      m.fixed_bytes > 16_384 || !Array.isArray(m.sections) ||
      m.sections.length !== SECTIONS.length)
    throw Error("Vanta combined BOUND4 artifacts are not approved");
  m.sections.forEach((s, n) => {
    const curve = s.id === "B_G2" ? "G2" : "G1";
    if (s.id !== SECTIONS[n] || s.curve !== curve ||
        !Number.isSafeInteger(s.point_count) || s.point_count < 1 ||
        s.point_count > MAX_POINTS ||
        !Number.isSafeInteger(s.bytes) ||
        s.bytes !== s.point_count * (curve === "G2" ? 128 : 64) ||
        !Array.isArray(s.chunks) || s.chunks.length > 256)
      throw Error("Vanta combined BOUND4 query section is malformed");
    let nextPoint = 0, nextByte = 0;
    for (const c of s.chunks) {
      if (!Number.isSafeInteger(c.offset) || c.offset !== nextByte ||
          !Number.isSafeInteger(c.point_start) || c.point_start !== nextPoint ||
          !Number.isSafeInteger(c.point_count) || c.point_count < 1 ||
          c.point_count > MAX_CHUNK_POINTS ||
          !Number.isSafeInteger(c.length) ||
          c.length !== c.point_count * (curve === "G2" ? 128 : 64) ||
          !HASH.test(c.sha256))
        throw Error("Vanta combined BOUND4 query chunk is malformed");
      nextPoint += c.point_count;
      nextByte += c.length;
    }
    if (nextPoint !== s.point_count || nextByte !== s.bytes)
      throw Error("Vanta combined BOUND4 query manifest is incomplete");
  });
}

function validateMatrixManifest(m: VantaCombinedBound4MatrixManifest, fileHash: string,
  profile: RelationProfile): void {
  if (!m || m.schema !== "vanta-v8-combined-bound4-offline-matrix-v1" ||
      m.chain_id !== profile.chainId || m.format_version !== 2 ||
      !Number.isSafeInteger(m.constraints) || m.constraints < 1 || m.constraints >= MAX_POINTS ||
      m.constraints !== profile.constraints || m.instance_variables !== profile.publicSignals + 1 ||
      (profile.committedWitnesses === 1 &&
        (m.commitment_scheme !== "ccgroth16-policy-v1" || m.committed_witnesses !== 1)) ||
      (profile.familyTag !== undefined && (m.selected_proof_path !== "STREAM_BOUND4" ||
        m.relation !== profile.relation || m.family_tag !== profile.familyTag ||
        m.witness_variables !== profile.witnesses || !HASH.test(m.r1cs_sha256 ?? ""))) ||
      !Number.isSafeInteger(m.witness_variables) || m.witness_variables < 1 ||
      m.witness_variables > MAX_POINTS || m.qap_domain_size !== profile.domain ||
      !HASH.test(m.file_sha256) || !HASH.test(fileHash) ||
      m.file_sha256.toLowerCase() !== fileHash.toLowerCase() ||
      !HASH.test(m.dictionary_sha256) ||
      !Number.isSafeInteger(m.dictionary_bytes) || m.dictionary_bytes < 12 ||
      m.dictionary_bytes > 262_144 ||
      !Number.isSafeInteger(m.file_bytes) ||
      m.file_bytes <= m.dictionary_bytes || m.file_bytes > 8 * 1024 * 1024 ||
      !Array.isArray(m.blocks) || m.blocks.length === 0 || m.blocks.length > 300)
    throw Error("Vanta combined BOUND4 offline matrix manifest is not pinned");
  let bytePos = m.dictionary_bytes;
  const nextRow = [0, 0, 0];
  let lastId = 0;
  for (const block of m.blocks) {
    const id = block.matrix_id;
    if (!Number.isInteger(id) || id < 0 || id > 2 || id < lastId ||
        block.label !== (["A", "B", "C"] as const)[id] ||
        !Number.isSafeInteger(block.row_start) || block.row_start !== nextRow[id] ||
        !Number.isSafeInteger(block.row_count) || block.row_count < 1 ||
        block.row_count > 1024 || nextRow[id] + block.row_count > m.constraints ||
        !Number.isSafeInteger(block.offset) || block.offset !== bytePos ||
        !Number.isSafeInteger(block.length) || block.length < 1 ||
        block.length > 65_536 || !HASH.test(block.sha256))
      throw Error("Vanta combined BOUND4 offline matrix block is malformed");
    lastId = id;
    nextRow[id] += block.row_count;
    bytePos += block.length;
  }
  if (nextRow.some(r => r !== m.constraints) || bytePos !== m.file_bytes)
    throw Error("Vanta combined BOUND4 offline matrix blocks are incomplete");
}

const fieldHex = (v: bigint): string => "0x" + v.toString(16).padStart(64, "0");
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw Error("Vanta proof cancelled");
};

export type VantaStandardBound4Input = Readonly<{
  wasm: VantaCombinedBound4Wasm;
  manifest: VantaCombinedBound4KeyManifest;
  approvedKeySha256: string;
  fixedKey: Uint8Array;
  policyLookupKey?: Uint8Array;
  approvedPolicyLookupKeySha256?: string;
  matrixManifest: VantaCombinedBound4MatrixManifest;
  approvedMatrixSha256: string;
  readMatrixChunk: (offset: number, length: number) => Promise<Uint8Array>;
  walletWitness: unknown;
  readQueryChunk: (section: Section, offset: number, length: number) => Promise<Uint8Array>;
  createShardWorker: () => VantaBound4ShardWorker;
  signal?: AbortSignal;
  onProgress?: (stage: Section | "verified") => void;
}>;

/** One bounded matrix/query implementation shared with the existing research
 * combined driver. Aggregate chooses its explicit Rust constructor, never a
 * full-key function. All MSM sessions have exactly four local workers. */
async function proveStandardBound4(input: VantaStandardBound4Input,
  profile: RelationProfile, shardWidth: 8 | 32): Promise<Record<string, unknown>> {
  validateManifest(input.manifest, input.approvedKeySha256, profile);
  validateMatrixManifest(input.matrixManifest, input.approvedMatrixSha256, profile);
  if (profile.familyTag !== undefined && input.manifest.r1cs_sha256 !== input.matrixManifest.r1cs_sha256)
    throw Error("Vanta family BOUND4 key and matrix R1CS differ");
  if (!(input.fixedKey instanceof Uint8Array) ||
      input.fixedKey.length !== input.manifest.fixed_bytes ||
      sha256(input.fixedKey).slice(2).toLowerCase() !== input.manifest.fixed_sha256.toLowerCase())
    throw Error("Vanta combined BOUND4 fixed key is not pinned");
  const shards: Shard[] = [];
  if (profile.relation === "payout-aggregate" &&
      typeof input.wasm.VantaCombinedBound4Prover.newAggregate !== "function")
    throw Error("Vanta aggregate STREAM_BOUND4 constructor is unavailable");
  if (profile.relation === "enhanced-fee-partner" &&
      typeof input.wasm.VantaCombinedBound4Prover.newEnhanced !== "function")
    throw Error("Vanta enhanced fee STREAM_BOUND4 constructor is unavailable");
  const prover = profile.relation === "payout-aggregate"
    ? input.wasm.VantaCombinedBound4Prover.newAggregate!()
    : profile.relation === "enhanced-fee-partner"
      ? input.wasm.VantaCombinedBound4Prover.newEnhanced!()
      : new input.wasm.VantaCombinedBound4Prover();
  try {
    checkAbort(input.signal);
    prover.loadFixed(input.fixedKey, input.manifest.fixed_sha256);
    if (profile.committedWitnesses === 1) {
      const lookupKey = input.policyLookupKey, pin = input.approvedPolicyLookupKeySha256;
      if (!(lookupKey instanceof Uint8Array) || lookupKey.length < 1 || lookupKey.length > 512 * 1024 ||
          typeof pin !== "string" || !HASH.test(pin) || sha256(lookupKey).slice(2) !== pin.toLowerCase() ||
          typeof prover.loadPolicyLookupKey !== "function")
        throw Error("Vanta KZG policy lookup material is not pinned");
      prover.loadPolicyLookupKey(lookupKey, pin);
    }
    const matrix = input.matrixManifest;
    const dictionary = await input.readMatrixChunk(0, matrix.dictionary_bytes);
    if (!(dictionary instanceof Uint8Array) ||
        dictionary.length !== matrix.dictionary_bytes ||
        sha256(dictionary).slice(2).toLowerCase() !== matrix.dictionary_sha256.toLowerCase())
      throw Error("Vanta combined BOUND4 dictionary hash mismatch");
    try { prover.loadMatrixDictionary(dictionary, matrix.dictionary_sha256); }
    finally { dictionary.fill(0); }
    const prepared = Object.fromEntries(prover.beginOfflineBound4(input.walletWitness));
    const counts = prepared.msm_points;
    if (prepared.offline_matrix_required !== true ||
        prepared.constraints !== matrix.constraints ||
        prepared.public_inputs !== matrix.instance_variables - 1 ||
        prepared.witness_variables !== matrix.witness_variables ||
        prepared.domain_size !== matrix.qap_domain_size ||
        !Array.isArray(counts) || counts.length !== SECTIONS.length ||
        counts.some((n, i) => n !== input.manifest.sections[i].point_count))
      throw Error("Vanta combined BOUND4 offline R1CS family changed");

    for (let id = 0; id < 3; ++id) {
      checkAbort(input.signal);
      if (id === 2) prover.finishAB();
      for (const block of matrix.blocks.filter(b => b.matrix_id === id)) {
        checkAbort(input.signal);
        const bytes = await input.readMatrixChunk(block.offset, block.length);
        if (!(bytes instanceof Uint8Array) || bytes.length !== block.length ||
            sha256(bytes).slice(2).toLowerCase() !== block.sha256.toLowerCase())
          throw Error("Vanta combined BOUND4 matrix block hash mismatch");
        try {prover.applyMatrixBlock(id, block.row_start, block.row_count, bytes);}
        finally {bytes.fill(0);}
      }
    }
    prover.finishC();
    await initializeBound4Shards(shards, input.createShardWorker, shardWidth, input.signal);
    const results = new Map<Section, Uint8Array>();
    for (const section of input.manifest.sections) {
      checkAbort(input.signal);
      const windowBits = section.curve === "G2" ? 11 : 13;
      const windows = input.wasm.VantaM2MsmShard.totalWindows(windowBits);
      if (!Number.isSafeInteger(windows) || windows < 4 || windows > 64)
        throw Error("Vanta BOUND4 MSM window count is invalid");
      const started = await Promise.all(shards.map((s, i) => s.call("start", {
        curve: section.curve, windowBits,
        from: Math.floor(i * windows / 4),
        to: Math.floor((i + 1) * windows / 4), points: section.point_count,
      })));
      if (started.some(reply => reply !== true)) throw Error("Vanta BOUND4 worker section rejected");
      for (const chunk of section.chunks) {
        checkAbort(input.signal);
        const query = await input.readQueryChunk(section.id, chunk.offset, chunk.length);
        if (!(query instanceof Uint8Array) || query.length !== chunk.length ||
            sha256(query).slice(2).toLowerCase() !== chunk.sha256.toLowerCase())
          throw Error("Vanta combined BOUND4 query hash mismatch");
        let scalars: Uint8Array | undefined;
        let digits: Int16Array | undefined;
        try {
          scalars = prover.scalarChunk(section.id, chunk.point_start, chunk.point_count);
          digits = input.wasm.vantaM2SignedDigits(scalars, windowBits);
          if (!(scalars instanceof Uint8Array) || scalars.length !== chunk.point_count * 32 ||
              !(digits instanceof Int16Array) || digits.length !== chunk.point_count * windows)
            throw Error("Vanta combined BOUND4 signed-digit length mismatch");
          const replies = await Promise.all(shards.map(s => {
            const q = Uint8Array.from(query);
            const d = digits!.slice();
            return s.call<boolean>("push", {
              query: q.buffer, digits: d.buffer,
              pointStart: chunk.point_start, pointCount: chunk.point_count,
            }, [q.buffer as ArrayBuffer, d.buffer as ArrayBuffer]);
          }));
          if (replies.some(r => r !== true))
            throw Error("Vanta combined BOUND4 MSM chunk rejected");
        } finally {query.fill(0);scalars?.fill(0);digits?.fill(0);}
      }
      const parts = await Promise.all(shards.map(s => s.call<ArrayBuffer>("finish", {})));
      if (parts.some(part => !(part instanceof ArrayBuffer) ||
          part.byteLength !== (section.curve === "G2" ? 64 : 32)))
        throw Error("Vanta BOUND4 MSM partial result encoding differs");
      const combined = new Uint8Array(parts.reduce((acc, p) => acc + p.byteLength, 0));
      let off = 0;
      for (const part of parts) {
        const bytes = new Uint8Array(part);
        combined.set(bytes, off);
        off += bytes.length;
        bytes.fill(0);
      }
      try {
        results.set(section.id, section.curve === "G2"
          ? input.wasm.vantaM2CombineG2(combined, 4)
          : input.wasm.vantaM2CombineG1(combined, 4));
      } finally {combined.fill(0);}
      input.onProgress?.(section.id);
    }
    const p = (section: Section): Uint8Array => {
      const point = results.get(section);
      if (!point) throw Error("Vanta combined BOUND4 MSM is incomplete");
      return point;
    };
    // serde_wasm_bindgen emits nested maps for the public aggregate VK. Flatten
    // the complete public result so ethers can encode its tuple components.
    const plain = (value: unknown): any => value instanceof Map
      ? Object.fromEntries([...value].map(([key, item]) => [key, plain(item)]))
      : Array.isArray(value) ? value.map(plain) : value;
    const proof = plain(prover.finishBound4(
      p("H"), p("L"), p("A"), p("B_G1"), p("B_G2"),
    ));
    for (const point of results.values()) point.fill(0);
    const signalFields = proof.public_signals;
    if (proof.verified_locally !== true || !Array.isArray(signalFields) ||
        signalFields.length !== profile.publicSignals || !signalFields.every(s => typeof s === "string") ||
        !isHexString(proof.proof, profile.committedWitnesses === 1 ? 1088 : 256) ||
        (profile.committedWitnesses === 1 &&
          (proof.commitment_scheme !== "ccgroth16-policy-v1" || proof.committed_witnesses !== 1)))
      throw Error("Vanta BOUND4 proof failed local verifier");
    checkAbort(input.signal);
    return proof;
  } finally {
    for (const shard of shards) { try {shard.terminate();} catch { /* Continue disposing every worker. */ } }
    try {prover.abortBound4();} finally {prover.free();}
  }
}

/** Existing Base research API, with the same statement and return shape. */
export async function proveVantaV8CombinedFeePartnerBound4InWallet(input: VantaStandardBound4Input &
  Readonly<{expected: VantaV8CombinedProofExpectation}>): Promise<VantaV8CombinedFeeProof> {
  if (!((input.expected.mode === 2 && input.expected.width === 0) ||
        (input.expected.mode <= 1 && (input.expected.width === 8 || input.expected.width === 32))))
    throw Error("Vanta combined BOUND4 proof profile is invalid");
  const proof = await proveStandardBound4(input, LEGACY_COMBINED,
    input.expected.width === 0 ? 8 : input.expected.width);
  const signalFields = proof.public_signals as string[];
  const numeric = (i: number): bigint => BigInt(signalFields[i]);
  const response = JSON.stringify({
    schema: "vanta-v8-unified-combined-fee-partner-proof-v1",
    chain_id: 84532, mode: Number(numeric(7)), width: Number(numeric(6)),
    output_count: Number(numeric(8)), verified_locally: true,
    research_only: true, safe_for_funds: false,
    proof: proof.proof, public_signals: signalFields,
    commitments: Array.from({ length: 5 }, (_, i) => fieldHex(numeric(20 + i))),
    fee_terms_hash: fieldHex(numeric(5)),
  });
  const {validateVantaV8CombinedFeeProofResponse} = await import("./unified-combined-fee-browser.js");
  const result = validateVantaV8CombinedFeeProofResponse(response, input.expected);
  input.onProgress?.("verified");
  return result;
}

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const canonicalField = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value) && BigInt(value) < FR;
export type VantaFamilyStandardBound4Input = VantaStandardBound4Input & Readonly<{
  descriptor: VantaFamilyBound4Descriptor;
  relation: "payout-aggregate" | "combined-fee-partner" | "enhanced-fee-partner";
  width: 0 | 8 | 32;
  /** Exact signed-action public inputs assembled by the trusted wallet. */
  expectedPublicSignals: readonly string[];
}>;
export async function proveVantaFamilyStandardBound4InWallet(input: VantaFamilyStandardBound4Input) {
  const selected = selectVantaFamilyBound4Driver(input.descriptor, input.relation, input.width);
  const aggregate = selected.relation === "payout-aggregate";
  const enhanced = selected.relation === "enhanced-fee-partner";
  const profile: RelationProfile = {chainId: selected.chainId, familyTag: selected.familyTag,
    relation: input.relation, publicSignals: aggregate ? 13 : enhanced ? 41 : 40,
    constraints: aggregate ? 12_002 : input.matrixManifest.constraints,
    witnesses: aggregate ? 9_047 : input.matrixManifest.witness_variables,
    committedWitnesses: aggregate ? 0 : 1, domain: aggregate ? 16_384 : 65_536};
  const expected = input.expectedPublicSignals;
  if (!Array.isArray(expected) || expected.length !== profile.publicSignals ||
      !expected.every(canonicalField) ||
      (enhanced
        ? expected[34] !== selected.familyTag || BigInt(expected[0]) !== BigInt(selected.chainId) ||
          BigInt(expected[6]) !== BigInt(input.width) || ![0n, 3n].includes(BigInt(expected[7]))
        : expected[expected.length - 2] !== selected.familyTag || BigInt(expected[expected.length - 1]) !== BigInt(selected.chainId) ||
          (!aggregate && (BigInt(expected[0]) !== BigInt(selected.chainId) ||
            BigInt(expected[6]) !== BigInt(input.width) ||
            (input.width === 0 ? BigInt(expected[7]) !== 2n : ![0n,1n,4n,5n].includes(BigInt(expected[7])))))))
    throw Error("Vanta family BOUND4 expected statement differs from its domain or operation");
  const proof = await proveStandardBound4(input, profile, input.width === 32 ? 32 : 8);
  const signals = proof.public_signals as unknown[];
  if (proof.selected_proof_path !== "STREAM_BOUND4" || proof.relation !== input.relation ||
      proof.chain_id !== selected.chainId || proof.family_tag !== selected.familyTag ||
      !signals.every((signal, i) => canonicalField(signal) && signal === expected[i]))
    throw Error("Vanta family BOUND4 proof differs from the expected signed action");
  input.onProgress?.("verified");
  return Object.freeze({...proof, public_signals: Object.freeze([...signals]) as readonly string[],
    research_only: true as const, safe_for_funds: false as const,
    verified_locally: true as const, selected_proof_path: "STREAM_BOUND4" as const});
}
