/**
 * Existing genuine 8x5/32x5 Gate0 ccGroth16, Caulk+ and CP_link through
 * four same-origin STREAM_BOUND4 MSM workers. Runs in the trusted wallet.
 * This is research-only. Accepted setup/keys must be checked separately
 * before any custody use; no witness or openings leave the wallet worker.
 */
import { sha256 } from "ethers";
import { sha256 as incrementalSha256 } from "@noble/hashes/sha256";
import { Shard, initializeBound4Shards, type VantaBound4ShardWorker } from "./unified-combined-fee-bound4-browser.js";
import {selectVantaFamilyBound4Driver, type VantaFamilyBound4Descriptor}
  from "./family-bound4-domain.js";

const SECTIONS = ["H", "L", "A", "B_G1", "B_G2"] as const;
type Section = typeof SECTIONS[number];
const HASH = /^[0-9a-f]{64}$/i;
const FIELD = /^0x[0-9a-f]{64}$/i;
const LOCK = /^sha256:[0-9a-f]{64}$/i;
const MAX_MATRIX = 32 * 1024 * 1024;
const MAX_PACKAGE = 128 * 1024 * 1024;
const SHARD_POINTS = 512;
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

type Chunk = { section_id: string; point_start: number; point_count: number;
  offset: number; length: number; sha256: string };
type KeySection = { id: string; curve: string; point_width: number; point_count: number;
  offset: number; length: number; sha256: string; chunks: Chunk[] };
type KeyManifest = { schema: string; version: number; curve: string; chunk_points: number;
  package_bytes: number; package_sha256: string; committed_witness_start: number;
  committed_witness_count: number; research_only: boolean; safe_for_funds: boolean;
  sections: KeySection[] };
type MatrixBlock = { matrix: string; matrix_id: number; row_start: number;
  row_count: number; offset: number; length: number };
type MatrixManifest = { schema: string; format_version: number; relation: string;
  matrix_sha256: string; matrix_file_bytes: number; dictionary_bytes: number;
  constraints: number; instance_variables: number; witness_variables: number;
  qap_domain_size: number; block_rows: number; research_only: boolean;
  safe_for_funds: boolean; blocks: MatrixBlock[] };

/** Exact public methods of the already compiled Gate0 Rust/WASM entry point. */
export type VantaV8FullBound4Wasm = Readonly<{
  VantaOfflineMatrixProver: new () => {
    loadM2Fixed(bytes: Uint8Array, sha: string): unknown;
    loadM2Cw(bytes: Uint8Array, sha: string): unknown;
    loadMatrixDictionary(bytes: Uint8Array): unknown;
    beginOfflineMatrixV8Wallet(witness: unknown, binding: unknown,
      constraints: number, instances: number, witnesses: number, domain: number): unknown;
    applyMatrixBlock(id: number, start: number, rows: number, bytes: Uint8Array): unknown;
    finishAB(): unknown;
    beginC(): unknown;
    finishCPrepareM2(): unknown;
    m2ScalarChunk(section: string, start: number, count: number): Uint8Array;
    applyM2MsmResult(section: string, point: Uint8Array): void;
    finishM2Proof(): unknown;
    finishWalletFullBundle(material: unknown, cache: unknown): unknown;
    abortSession(): void;
    free(): void;
  };
  VantaM2MsmShard: { totalWindows(bits: number): number };
  vantaM2SignedDigits(bytes: Uint8Array, bits: number): Int16Array;
  vantaM2CombineG1(parts: Uint8Array, count: number): Uint8Array;
  vantaM2CombineG2(parts: Uint8Array, count: number): Uint8Array;
}>;

export type VantaV8ThreeProofResearchBundle = Readonly<{
  schema: string; research_only: true; safe_for_funds: false; chain_id: number;
  setup_lock_sha256: string; checkpoint_ref: string; source_epoch: number;
  gate0: { browser_generated: true; verified_locally: true; public_statement: string };
  gate1: { browser_generated: true; verified_locally: true };
  cp_link: { browser_generated: true; verified_locally: true };
  [key: string]: unknown;
}>;

const digest = (bytes: Uint8Array): string => sha256(bytes).slice(2).toLowerCase();
const fail = (problem: string): never => { throw Error(`Vanta full BOUND4 ${problem}`); };
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail("proof cancelled");
};
function requireHash(bytes: Uint8Array, size: number, expected: string) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== size ||
      !HASH.test(expected) || digest(bytes) !== expected.toLowerCase())
    fail("artifact SHA-256 mismatch");
}
function pinnedJson<T>(bytes: Uint8Array, expected: string): T {
  if (!(bytes instanceof Uint8Array) || !HASH.test(expected) ||
      digest(bytes) !== expected.toLowerCase()) fail("manifest SHA-256 mismatch");
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
  catch { return fail("manifest is invalid JSON"); }
}

function validateKey(m: KeyManifest, width: 8 | 32, expected: string): Map<string, KeySection> {
  if (!m || m.schema !== "stealthos-vanta-m2-ccgroth16-pk-v2" || m.version !== 2 ||
      m.curve !== "BN254" || m.chunk_points !== 8192 ||
      m.research_only !== true || m.safe_for_funds !== false ||
      m.committed_witness_start !== 0 || m.committed_witness_count !== width ||
      !HASH.test(expected) || m.package_sha256?.toLowerCase() !== expected.toLowerCase() ||
      !Number.isSafeInteger(m.package_bytes) || m.package_bytes < 1 ||
      m.package_bytes > MAX_PACKAGE || !Array.isArray(m.sections) || m.sections.length !== 7)
    fail("M2 key family is not approved");
  const order = ["fixed", ...SECTIONS, "CW"];
  let end = 0;
  for (let i = 0; i < order.length; ++i) {
    const s = m.sections[i];
    const curve = order[i] === "fixed" ? "fixed" : order[i] === "B_G2" ? "G2" : "G1";
    const pointWidth = curve === "fixed" ? 0 : curve === "G2" ? 128 : 64;
    if (!s || s.id !== order[i] || s.curve !== curve || s.point_width !== pointWidth ||
        s.offset !== end || !Number.isSafeInteger(s.length) || s.length < 1 ||
        !HASH.test(s.sha256) || !Array.isArray(s.chunks) ||
        (s.id === "fixed" && (s.point_count !== 0 || s.chunks.length !== 0 || s.length > 8192)) ||
        (s.id !== "fixed" && (!Number.isSafeInteger(s.point_count) || s.point_count < 1 ||
          s.point_count > 65536 || s.length !== s.point_count * pointWidth || !s.chunks.length)) ||
        (s.id === "CW" && s.point_count !== width + 2))
      fail("M2 key section is malformed");
    let point = 0, pos = s.offset;
    for (const c of s.chunks) {
      if (c.section_id !== s.id || c.point_start !== point || c.offset !== pos ||
          !Number.isSafeInteger(c.point_count) || c.point_count < 1 ||
          c.point_count > m.chunk_points || c.length !== c.point_count * pointWidth ||
          !HASH.test(c.sha256)) fail("M2 query chunk is malformed");
      point += c.point_count; pos += c.length;
    }
    if (s.id !== "fixed" && (point !== s.point_count || pos !== s.offset + s.length))
      fail("M2 key section is incomplete");
    end += s.length;
  }
  if (end !== m.package_bytes) fail("M2 key package length mismatch");
  return new Map(m.sections.map(s => [s.id, s]));
}

function validateMatrix(m: MatrixManifest, width: 8 | 32, expected: string, family: boolean) {
  if (!m || m.schema !== "stealthos-vanta-gate0-offline-matrix-v2" ||
      m.format_version !== 2 || m.relation !== `vanta-v8-epoch-private-fee-${width}x5-v1` ||
      m.research_only !== true || m.safe_for_funds !== false || !HASH.test(expected) ||
      m.matrix_sha256?.toLowerCase() !== expected.toLowerCase() ||
      !Number.isSafeInteger(m.matrix_file_bytes) || m.matrix_file_bytes > MAX_MATRIX ||
      !Number.isSafeInteger(m.dictionary_bytes) || m.dictionary_bytes < 12 ||
      m.dictionary_bytes > 262144 || m.dictionary_bytes >= m.matrix_file_bytes ||
      !Number.isSafeInteger(m.constraints) || m.constraints < 1 || m.constraints > 65531 ||
      m.instance_variables !== (family ? 7 : 5) || !Number.isSafeInteger(m.witness_variables) ||
      m.witness_variables < width || m.witness_variables > 65536 ||
      m.qap_domain_size !== (width === 8 ? 32768 : 65536) || !Number.isSafeInteger(m.block_rows) ||
      m.block_rows < 1 || m.block_rows > 1024 || !Array.isArray(m.blocks) ||
      m.blocks.length < 3 || m.blocks.length > 600) fail("offline matrix is not approved");
  let offset = m.dictionary_bytes, id = 0, row = 0;
  for (const b of m.blocks) {
    if (b.matrix_id !== id || b.matrix !== ["A", "B", "C"][id] ||
        b.row_start !== row || !Number.isSafeInteger(b.row_count) || b.row_count < 1 ||
        b.row_count > m.block_rows || row + b.row_count > m.constraints ||
        b.offset !== offset || !Number.isSafeInteger(b.length) ||
        b.length < 1 || b.length > 1048576)
      fail("offline matrix block is malformed");
    row += b.row_count; offset += b.length;
    if (row === m.constraints) { ++id; row = 0; }
  }
  if (id !== 3 || offset !== m.matrix_file_bytes) fail("offline matrix is incomplete");
}

/** The caller must obtain each approved hash from a trusted release, not the CDN manifest. */
export async function proveVantaV8FullBound4InWallet(input: Readonly<{
  width: 8 | 32;
  /** Explicit opt-in; legacy research callers keep their original Base relation. */
  family?: Readonly<{descriptor: VantaFamilyBound4Descriptor; relation: "normal" | "exit"}>;
  wasm: VantaV8FullBound4Wasm;
  m2ManifestBytes: Uint8Array;
  approvedM2ManifestSha256: string;
  approvedM2PackageSha256: string;
  matrixManifestBytes: Uint8Array;
  approvedMatrixManifestSha256: string;
  approvedMatrixSha256: string;
  /** Must equal the Rust WASM's independently accepted build-time setup lock. */
  approvedSetupLockSha256: string;
  walletWitness: unknown;
  hashBinding: unknown;
  publicMaterial: unknown;
  authenticatedWalletCache: unknown;
  expectedPublicStatement: string;
  expectedCheckpointRef: string;
  expectedSourceEpoch: number;
  readM2Chunk: (offset: number, length: number) => Promise<Uint8Array>;
  readMatrixChunk: (offset: number, length: number) => Promise<Uint8Array>;
  createShardWorker: () => VantaBound4ShardWorker;
  signal?: AbortSignal;
  onProgress?: (stage: Section | "gate0_verified" | "bundle_verified") => void;
}>): Promise<VantaV8ThreeProofResearchBundle> {
  if (input.width !== 8 && input.width !== 32) fail("width must be 8 or 32");
  const selected = input.family ? selectVantaFamilyBound4Driver(
    input.family.descriptor, input.family.relation, input.width) : null;
  const chainId = selected?.chainId ?? 84532;
  const kind = input.family?.relation === "exit" ? "exit" : "epoch";
  if (!LOCK.test(input.approvedSetupLockSha256) ||
      !FIELD.test(input.expectedPublicStatement) || !FIELD.test(input.expectedCheckpointRef) ||
      !Number.isSafeInteger(input.expectedSourceEpoch) || input.expectedSourceEpoch < 0)
    fail("trusted setup or wallet binding is invalid");
  const keyManifest = pinnedJson<KeyManifest>(input.m2ManifestBytes, input.approvedM2ManifestSha256);
  const matrix = pinnedJson<MatrixManifest>(input.matrixManifestBytes,
    input.approvedMatrixManifestSha256);
  const key = validateKey(keyManifest, input.width, input.approvedM2PackageSha256);
  validateMatrix(matrix, input.width, input.approvedMatrixSha256, selected !== null);
  const publicMaterial = input.publicMaterial as Record<string, unknown> | null;
  if (!publicMaterial || typeof publicMaterial !== "object" ||
      publicMaterial.schema !== `vanta-v8-${kind}-${input.width}x5-gate1-public-material-v1` ||
      publicMaterial.research_only !== true || publicMaterial.safe_for_funds !== false ||
      publicMaterial.chain_id !== chainId || publicMaterial.table_n !== 65536 ||
      publicMaterial.query_slots !== input.width ||
      publicMaterial.setup_lock_sha256 !== input.approvedSetupLockSha256)
    fail("Gate1 public material is not bound to the approved epoch family");
  const cache = input.authenticatedWalletCache as Record<string, unknown> | null;
  if (!cache || typeof cache !== "object" ||
      cache.schema !== `vanta-v8-${kind}-${input.width}x5-wallet-caulk-cache-v1` ||
      cache.research_only !== true || cache.safe_for_funds !== false ||
      cache.chain_id !== chainId || cache.table_id !== input.expectedSourceEpoch ||
      !Number.isSafeInteger(cache.slot_count) || Number(cache.slot_count) < 32 ||
      Number(cache.slot_count) > 65536 ||
      typeof cache.checkpoint_ref !== "string" ||
      cache.checkpoint_ref.toLowerCase() !== input.expectedCheckpointRef.toLowerCase() ||
      !Array.isArray(cache.openings) || cache.openings.length !== input.width)
    fail("wallet Caulk cache does not match the signed epoch checkpoint");
  const shards: Shard[] = [];
  const prover = new input.wasm.VantaOfflineMatrixProver();
  try {
    checkAbort(input.signal);
    for (const id of ["fixed", "CW"]) {
      const section = key.get(id)!;
      const bytes = await input.readM2Chunk(section.offset, section.length);
      requireHash(bytes, section.length, section.sha256);
      try {
        if (id === "fixed") prover.loadM2Fixed(bytes, section.sha256);
        else prover.loadM2Cw(bytes, section.sha256);
      } finally { bytes.fill(0); }
    }
    // The original exporter pins a full-file hash, not individual block hashes.
    // First authenticate the complete stream (bounded memory); then replay
    // each block against its recorded digest before giving it to Rust/WASM.
    // This also catches a remote artifact switching between the two passes.
    const matrixHasher = incrementalSha256.create();
    const readVerified = async (offset: number, length: number, expected: string) => {
      checkAbort(input.signal);
      const bytes = await input.readMatrixChunk(offset, length);
      requireHash(bytes, length, expected);
      return bytes;
    };
    const dictionary = await input.readMatrixChunk(0, matrix.dictionary_bytes);
    if (!(dictionary instanceof Uint8Array) || dictionary.length !== matrix.dictionary_bytes)
      fail("matrix dictionary length mismatch");
    const dictHash = digest(dictionary);
    matrixHasher.update(dictionary);
    dictionary.fill(0);
    const blockHashes: string[] = [];
    for (const block of matrix.blocks) {
      checkAbort(input.signal);
      const bytes = await input.readMatrixChunk(block.offset, block.length);
      if (!(bytes instanceof Uint8Array) || bytes.length !== block.length)
        fail("matrix block length mismatch");
      matrixHasher.update(bytes);
      blockHashes.push(digest(bytes));
      bytes.fill(0);
    }
    const fullHash = Array.from(matrixHasher.digest(), x => x.toString(16).padStart(2, "0")).join("");
    if (fullHash !== matrix.matrix_sha256.toLowerCase()) fail("matrix full-file hash mismatch");
    const verifiedDict = await readVerified(0, matrix.dictionary_bytes, dictHash);
    try { prover.loadMatrixDictionary(verifiedDict); }
    finally { verifiedDict.fill(0); }
    const prepared = prover.beginOfflineMatrixV8Wallet(
      input.walletWitness, input.hashBinding, matrix.constraints, matrix.instance_variables,
      matrix.witness_variables, matrix.qap_domain_size,
    ) as { constraints?: number; instance_variables?: number; witness_variables?: number;
      qap_domain_size?: number; full_assignment_len?: number };
    const assignment = matrix.instance_variables + matrix.witness_variables;
    if (!prepared || prepared.constraints !== matrix.constraints ||
        prepared.instance_variables !== matrix.instance_variables ||
        prepared.witness_variables !== matrix.witness_variables ||
        prepared.qap_domain_size !== matrix.qap_domain_size ||
        prepared.full_assignment_len !== assignment ||
        key.get("L")!.point_count !== matrix.witness_variables - input.width ||
        SECTIONS.filter(s => s !== "H" && s !== "L")
          .some(s => key.get(s)!.point_count !== assignment))
      fail("Gate0 R1CS differs from the pinned 8x5/32x5 family");
    for (let id = 0; id < 3; ++id) {
      checkAbort(input.signal);
      if (id === 2) { prover.finishAB(); prover.beginC(); }
      for (const [index, block] of matrix.blocks.entries()) {
        if (block.matrix_id !== id) continue;
        const bytes = await readVerified(block.offset, block.length, blockHashes[index]);
        try { prover.applyMatrixBlock(id, block.row_start, block.row_count, bytes); }
        finally { bytes.fill(0); }
      }
    }
    prover.finishCPrepareM2();
    await initializeBound4Shards(shards, input.createShardWorker, input.width, input.signal);
    for (const id of SECTIONS) {
      checkAbort(input.signal);
      const section = key.get(id)!;
      const bits = section.curve === "G2" ? 11 : 13;
      const windows = input.wasm.VantaM2MsmShard.totalWindows(bits);
      if (!Number.isSafeInteger(windows) || windows < 1 || windows > 64)
        fail("MSM window count differs from the existing shard protocol");
      const started = await Promise.all(shards.map((s, i) => s.call("start", {
        curve: section.curve, windowBits: bits, points: section.point_count,
        from: Math.floor(i * windows / 4), to: Math.floor((i + 1) * windows / 4),
      })));
      if (started.some(reply => reply !== true)) fail("MSM worker section rejected");
      for (const chunk of section.chunks) {
        checkAbort(input.signal);
        const query = await input.readM2Chunk(chunk.offset, chunk.length);
        requireHash(query, chunk.length, chunk.sha256);
        try {
          // The exporter writes 8,192-point key chunks. Push them to the
          // existing four workers in <=512-point STREAM_BOUND4 subchunks.
          for (let start = 0; start < chunk.point_count; start += SHARD_POINTS) {
            checkAbort(input.signal);
            const count = Math.min(SHARD_POINTS, chunk.point_count - start);
            const points = query.subarray(start * section.point_width,
              (start + count) * section.point_width);
            const scalars = prover.m2ScalarChunk(id, chunk.point_start + start, count);
            let digits: Int16Array | undefined;
            try {
              if (!(scalars instanceof Uint8Array) || scalars.length !== count * 32)
                fail("MSM scalar chunk length mismatch");
              digits = input.wasm.vantaM2SignedDigits(scalars, bits);
              if (!(digits instanceof Int16Array) || digits.length !== count * windows)
                fail("MSM signed digit length mismatch");
              const results = await Promise.all(shards.map(shard => {
                const q = Uint8Array.from(points), d = digits!.slice();
                return shard.call<boolean>("push", {
                  query: q.buffer, digits: d.buffer,
                  pointStart: chunk.point_start + start, pointCount: count,
                }, [q.buffer as ArrayBuffer, d.buffer as ArrayBuffer]);
              }));
              if (results.some(x => x !== true)) fail("MSM worker rejected a subchunk");
            } finally { scalars.fill(0); digits?.fill(0); }
          }
        } finally { query.fill(0); }
      }
      const partials = await Promise.all(shards.map(s => s.call<ArrayBuffer>("finish", {})));
      if (partials.some(part => !(part instanceof ArrayBuffer) ||
          part.byteLength !== (section.curve === "G2" ? 64 : 32)))
        fail("MSM partial result encoding differs");
      const bytes = new Uint8Array(partials.reduce((n, p) => n + p.byteLength, 0));
      let offset = 0;
      for (const part of partials) {
        const view = new Uint8Array(part);
        bytes.set(view, offset);
        offset += view.length;
        view.fill(0);
      }
      let point: Uint8Array | undefined;
      try {
        point = section.curve === "G2" ? input.wasm.vantaM2CombineG2(bytes, 4)
          : input.wasm.vantaM2CombineG1(bytes, 4);
        prover.applyM2MsmResult(id, point);
      } finally { bytes.fill(0); point?.fill(0); }
      input.onProgress?.(id);
    }
    const gate0 = prover.finishM2Proof() as { verified?: boolean };
    if (gate0?.verified !== true) fail("ccGroth16 Gate0 did not verify locally");
    input.onProgress?.("gate0_verified");
    // Rust consumes its own verified Gate0 proof/commitment witness exactly
    // once and checks Gate1 and CP_link against the authenticated checkpoint.
    const bundle = prover.finishWalletFullBundle(input.publicMaterial,
      input.authenticatedWalletCache) as VantaV8ThreeProofResearchBundle;
    // Only accept the epoch-aware proof family emitted by the pinned V8
    // browser WASM; an older non-epoch research transcript is not equivalent.
    if (!bundle || bundle.schema !== `vanta-v8-${kind}-${input.width}x5-browser-three-proof-research-v1` ||
        bundle.research_only !== true || bundle.safe_for_funds !== false ||
        bundle.chain_id !== chainId || bundle.setup_lock_sha256 !== input.approvedSetupLockSha256 ||
        bundle.checkpoint_ref?.toLowerCase() !== input.expectedCheckpointRef.toLowerCase() ||
        bundle.source_epoch !== input.expectedSourceEpoch ||
        bundle.gate0?.public_statement?.toLowerCase() !== input.expectedPublicStatement.toLowerCase() ||
        [bundle.gate0, bundle.gate1, bundle.cp_link].some(x =>
          x?.browser_generated !== true || x?.verified_locally !== true))
      fail("full three-proof bundle is not bound to the requested wallet action");
    if (selected) {
      const signals = bundle.public_inputs ?? (bundle.gate0 as Record<string, unknown>).public_inputs;
      if (bundle.family_tag !== selected.familyTag || !Array.isArray(signals) || signals.length !== 6 ||
          !signals.every(value => typeof value === "string" && FIELD.test(value) && BigInt(value) < FR) ||
          signals[4] !== selected.familyTag || BigInt(signals[5]) !== BigInt(selected.chainId))
        fail("family tag or chain differs from the selected driver");
      const checkedSignals = signals as readonly string[];
      const nested = (bundle.gate0 as Record<string, unknown>).public_inputs;
      if (nested !== undefined && (!Array.isArray(nested) || nested.length !== checkedSignals.length ||
          nested.some((value, i) => value !== checkedSignals[i])))
        fail("Gate0 public input transcripts disagree");
    }
    checkAbort(input.signal);
    input.onProgress?.("bundle_verified");
    return bundle;
  } finally {
    for (const shard of shards) { try {shard.terminate();} catch { /* Dispose the remaining workers. */ } }
    try { prover.abortSession(); } finally { prover.free(); }
  }
}
