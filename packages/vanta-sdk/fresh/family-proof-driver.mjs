// packages/sdk/src/vanta/family-bound4-domain.ts
var VANTA_DOGEOS_FAMILY_TAG = "0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445", KZG_FIELDS = ["schema", "familyId", "networkId", "familyTag", "engine", "workerCount", "partnerPolicyScheme"].sort().join(",");
function validateVantaFamilyBound4Descriptor(value) {
  let v = value, chainId = typeof v?.networkId == "string" && /^eip155:[1-9][0-9]{0,15}$/u.test(v.networkId) ? Number(v.networkId.slice(7)) : NaN;
  if (!v || typeof v != "object" || Array.isArray(v) || v.schema !== "stealthos-family-bound4-driver-v2" || Object.keys(v).sort().join(",") !== KZG_FIELDS || v.partnerPolicyScheme !== "kzg-caulk-plus-cclink-v1" || v.familyId !== "dogeos" || !Number.isSafeInteger(chainId) || chainId <= 0 || v.familyTag !== VANTA_DOGEOS_FAMILY_TAG || v.engine !== "STREAM_BOUND4" || v.workerCount !== 4)
    throw Error("DogeOS family proofs require the pinned four-worker STREAM_BOUND4 driver.");
  return Object.freeze({ ...v });
}
function selectVantaFamilyBound4Driver(descriptor, relation, width) {
  let d = validateVantaFamilyBound4Descriptor(descriptor);
  if (!(relation === "normal" || relation === "exit" ? width === 8 || width === 32 : relation === "payout-aggregate" ? width === 0 : relation === "combined-fee-partner" ? width === 0 || width === 8 || width === 32 : relation === "enhanced-fee-partner" && (width === 8 || width === 32))) throw Error("Unsupported DogeOS family proof relation or width.");
  if ((relation === "combined-fee-partner" || relation === "enhanced-fee-partner") && (d.schema !== "stealthos-family-bound4-driver-v2" || d.partnerPolicyScheme !== "kzg-caulk-plus-cclink-v1"))
    throw Error("DogeOS fee proofs require the authenticated KZG policy profile.");
  return Object.freeze({
    engine: d.engine,
    workerCount: d.workerCount,
    selectedDriver: `vanta-family-${relation}-stream-bound4-${relation === "combined-fee-partner" || relation === "enhanced-fee-partner" ? "kzg-v1" : "v1"}`,
    relation,
    width,
    chainId: Number(d.networkId.slice(7)),
    familyTag: d.familyTag
  });
}

// packages/sdk/src/vanta/unified-gate0-full-bound4-browser.ts
import { sha256 as sha2562 } from "ethers";
import { sha256 as incrementalSha256 } from "@noble/hashes/sha256";

// packages/sdk/src/vanta/unified-combined-fee-bound4-browser.ts
import { isHexString, sha256 } from "ethers";
var SECTIONS = ["H", "L", "A", "B_G1", "B_G2"], MAX_POINTS = 65536, MAX_CHUNK_POINTS = 512, HASH = /^[0-9a-f]{64}$/i, Shard = class {
  constructor(worker, signal) {
    this.worker = worker;
    this.signal = signal;
    this.seq = 0;
    this.stopped = !1;
    this.pending = /* @__PURE__ */ new Set();
  }
  call(type, args, transfer = []) {
    if (this.stopped || this.signal?.aborted) return Promise.reject(Error("Vanta proof cancelled or worker terminated"));
    let id = ++this.seq;
    return new Promise((resolve, reject) => {
      let done = !1, timer, cleanup = () => {
        timer !== void 0 && clearTimeout(timer), this.pending.delete(cancel), this.worker.removeEventListener("message", msg), this.worker.removeEventListener("error", fail3), this.signal?.removeEventListener("abort", abort);
      }, settle = (value, error) => {
        done || (done = !0, cleanup(), error ? reject(error) : resolve(value));
      }, msg = (e) => {
        e.data?.id === id && (e.data.type === "error" ? settle(void 0, Error("Vanta MSM worker rejected a chunk")) : e.data.type === "success" ? settle(e.data.result) : settle(void 0, Error("Vanta MSM worker reply is malformed")));
      }, fail3 = (event) => {
        let cause = event.error?.message;
        settle(void 0, Error(cause === "Vanta worker memory exhausted" || cause === "Vanta worker bootstrap failed" ? cause : "Vanta MSM worker failed"));
      }, abort = () => settle(void 0, Error("Vanta proof cancelled")), cancel = (error) => settle(void 0, error);
      this.pending.add(cancel), timer = setTimeout(() => cancel(Error("Vanta MSM worker response timed out")), 12e4), this.worker.addEventListener("message", msg), this.worker.addEventListener("error", fail3), this.signal?.addEventListener("abort", abort, { once: !0 });
      try {
        this.worker.postMessage({ id, type, ...args }, transfer);
      } catch {
        settle(void 0, Error("Vanta MSM worker request failed"));
      }
    });
  }
  terminate() {
    if (!this.stopped) {
      this.stopped = !0;
      for (let cancel of this.pending) cancel(Error("Vanta MSM worker terminated"));
      this.worker.terminate();
    }
  }
};
async function initializeBound4Shards(shards, create, width, signal) {
  for (let i = 0; i < 4; ++i) {
    signal?.throwIfAborted();
    let worker = create();
    if (shards.some((shard2) => shard2.worker === worker))
      throw Error("Vanta BOUND4 requires four distinct local workers");
    let shard = new Shard(worker, signal);
    if (shards.push(shard), await shard.call("init", { width }) !== !0)
      throw Error("Vanta BOUND4 worker initialization rejected");
  }
}
function validateManifest(m, approvedKey, profile) {
  if (m?.schema !== "vanta-v8-combined-bound4-key-v1" || m.research_only !== !0 || m.chain_id !== profile.chainId || m.public_signals !== profile.publicSignals || m.qap_domain !== profile.domain || profile.familyTag !== void 0 && (m.selected_proof_path !== "STREAM_BOUND4" || m.relation !== profile.relation || m.family_tag !== profile.familyTag || !HASH.test(m.r1cs_sha256 ?? "")) || profile.committedWitnesses === 1 && (m.commitment_scheme !== "ccgroth16-policy-v1" || m.committed_witnesses !== 1) || m.section_count !== 5 || m.msm_chunk_points !== 512 || !HASH.test(m.pk_sha256) || !HASH.test(m.fixed_sha256) || m.pk_sha256.toLowerCase() !== approvedKey.toLowerCase() || !Number.isSafeInteger(m.fixed_bytes) || m.fixed_bytes < 1 || m.fixed_bytes > 16384 || !Array.isArray(m.sections) || m.sections.length !== SECTIONS.length)
    throw Error("Vanta combined BOUND4 artifacts are not approved");
  m.sections.forEach((s, n) => {
    let curve = s.id === "B_G2" ? "G2" : "G1";
    if (s.id !== SECTIONS[n] || s.curve !== curve || !Number.isSafeInteger(s.point_count) || s.point_count < 1 || s.point_count > MAX_POINTS || !Number.isSafeInteger(s.bytes) || s.bytes !== s.point_count * (curve === "G2" ? 128 : 64) || !Array.isArray(s.chunks) || s.chunks.length > 256)
      throw Error("Vanta combined BOUND4 query section is malformed");
    let nextPoint = 0, nextByte = 0;
    for (let c of s.chunks) {
      if (!Number.isSafeInteger(c.offset) || c.offset !== nextByte || !Number.isSafeInteger(c.point_start) || c.point_start !== nextPoint || !Number.isSafeInteger(c.point_count) || c.point_count < 1 || c.point_count > MAX_CHUNK_POINTS || !Number.isSafeInteger(c.length) || c.length !== c.point_count * (curve === "G2" ? 128 : 64) || !HASH.test(c.sha256))
        throw Error("Vanta combined BOUND4 query chunk is malformed");
      nextPoint += c.point_count, nextByte += c.length;
    }
    if (nextPoint !== s.point_count || nextByte !== s.bytes)
      throw Error("Vanta combined BOUND4 query manifest is incomplete");
  });
}
function validateMatrixManifest(m, fileHash, profile) {
  if (!m || m.schema !== "vanta-v8-combined-bound4-offline-matrix-v1" || m.chain_id !== profile.chainId || m.format_version !== 2 || !Number.isSafeInteger(m.constraints) || m.constraints < 1 || m.constraints >= MAX_POINTS || m.constraints !== profile.constraints || m.instance_variables !== profile.publicSignals + 1 || profile.committedWitnesses === 1 && (m.commitment_scheme !== "ccgroth16-policy-v1" || m.committed_witnesses !== 1) || profile.familyTag !== void 0 && (m.selected_proof_path !== "STREAM_BOUND4" || m.relation !== profile.relation || m.family_tag !== profile.familyTag || m.witness_variables !== profile.witnesses || !HASH.test(m.r1cs_sha256 ?? "")) || !Number.isSafeInteger(m.witness_variables) || m.witness_variables < 1 || m.witness_variables > MAX_POINTS || m.qap_domain_size !== profile.domain || !HASH.test(m.file_sha256) || !HASH.test(fileHash) || m.file_sha256.toLowerCase() !== fileHash.toLowerCase() || !HASH.test(m.dictionary_sha256) || !Number.isSafeInteger(m.dictionary_bytes) || m.dictionary_bytes < 12 || m.dictionary_bytes > 262144 || !Number.isSafeInteger(m.file_bytes) || m.file_bytes <= m.dictionary_bytes || m.file_bytes > 8 * 1024 * 1024 || !Array.isArray(m.blocks) || m.blocks.length === 0 || m.blocks.length > 300)
    throw Error("Vanta combined BOUND4 offline matrix manifest is not pinned");
  let bytePos = m.dictionary_bytes, nextRow = [0, 0, 0], lastId = 0;
  for (let block of m.blocks) {
    let id = block.matrix_id;
    if (!Number.isInteger(id) || id < 0 || id > 2 || id < lastId || block.label !== ["A", "B", "C"][id] || !Number.isSafeInteger(block.row_start) || block.row_start !== nextRow[id] || !Number.isSafeInteger(block.row_count) || block.row_count < 1 || block.row_count > 1024 || nextRow[id] + block.row_count > m.constraints || !Number.isSafeInteger(block.offset) || block.offset !== bytePos || !Number.isSafeInteger(block.length) || block.length < 1 || block.length > 65536 || !HASH.test(block.sha256))
      throw Error("Vanta combined BOUND4 offline matrix block is malformed");
    lastId = id, nextRow[id] += block.row_count, bytePos += block.length;
  }
  if (nextRow.some((r) => r !== m.constraints) || bytePos !== m.file_bytes)
    throw Error("Vanta combined BOUND4 offline matrix blocks are incomplete");
}
var checkAbort = (signal) => {
  if (signal?.aborted) throw Error("Vanta proof cancelled");
};
async function proveStandardBound4(input, profile, shardWidth) {
  if (validateManifest(input.manifest, input.approvedKeySha256, profile), validateMatrixManifest(input.matrixManifest, input.approvedMatrixSha256, profile), profile.familyTag !== void 0 && input.manifest.r1cs_sha256 !== input.matrixManifest.r1cs_sha256)
    throw Error("Vanta family BOUND4 key and matrix R1CS differ");
  if (!(input.fixedKey instanceof Uint8Array) || input.fixedKey.length !== input.manifest.fixed_bytes || sha256(input.fixedKey).slice(2).toLowerCase() !== input.manifest.fixed_sha256.toLowerCase())
    throw Error("Vanta combined BOUND4 fixed key is not pinned");
  let shards = [];
  if (profile.relation === "payout-aggregate" && typeof input.wasm.VantaCombinedBound4Prover.newAggregate != "function")
    throw Error("Vanta aggregate STREAM_BOUND4 constructor is unavailable");
  if (profile.relation === "enhanced-fee-partner" && typeof input.wasm.VantaCombinedBound4Prover.newEnhanced != "function")
    throw Error("Vanta enhanced fee STREAM_BOUND4 constructor is unavailable");
  let prover = profile.relation === "payout-aggregate" ? input.wasm.VantaCombinedBound4Prover.newAggregate() : profile.relation === "enhanced-fee-partner" ? input.wasm.VantaCombinedBound4Prover.newEnhanced() : new input.wasm.VantaCombinedBound4Prover();
  try {
    if (checkAbort(input.signal), prover.loadFixed(input.fixedKey, input.manifest.fixed_sha256), profile.committedWitnesses === 1) {
      let lookupKey = input.policyLookupKey, pin = input.approvedPolicyLookupKeySha256;
      if (!(lookupKey instanceof Uint8Array) || lookupKey.length < 1 || lookupKey.length > 512 * 1024 || typeof pin != "string" || !HASH.test(pin) || sha256(lookupKey).slice(2) !== pin.toLowerCase() || typeof prover.loadPolicyLookupKey != "function")
        throw Error("Vanta KZG policy lookup material is not pinned");
      prover.loadPolicyLookupKey(lookupKey, pin);
    }
    let matrix = input.matrixManifest, dictionary = await input.readMatrixChunk(0, matrix.dictionary_bytes);
    if (!(dictionary instanceof Uint8Array) || dictionary.length !== matrix.dictionary_bytes || sha256(dictionary).slice(2).toLowerCase() !== matrix.dictionary_sha256.toLowerCase())
      throw Error("Vanta combined BOUND4 dictionary hash mismatch");
    try {
      prover.loadMatrixDictionary(dictionary, matrix.dictionary_sha256);
    } finally {
      dictionary.fill(0);
    }
    let prepared = Object.fromEntries(prover.beginOfflineBound4(input.walletWitness)), counts = prepared.msm_points;
    if (prepared.offline_matrix_required !== !0 || prepared.constraints !== matrix.constraints || prepared.public_inputs !== matrix.instance_variables - 1 || prepared.witness_variables !== matrix.witness_variables || prepared.domain_size !== matrix.qap_domain_size || !Array.isArray(counts) || counts.length !== SECTIONS.length || counts.some((n, i) => n !== input.manifest.sections[i].point_count))
      throw Error("Vanta combined BOUND4 offline R1CS family changed");
    for (let id = 0; id < 3; ++id) {
      checkAbort(input.signal), id === 2 && prover.finishAB();
      for (let block of matrix.blocks.filter((b) => b.matrix_id === id)) {
        checkAbort(input.signal);
        let bytes = await input.readMatrixChunk(block.offset, block.length);
        if (!(bytes instanceof Uint8Array) || bytes.length !== block.length || sha256(bytes).slice(2).toLowerCase() !== block.sha256.toLowerCase())
          throw Error("Vanta combined BOUND4 matrix block hash mismatch");
        try {
          prover.applyMatrixBlock(id, block.row_start, block.row_count, bytes);
        } finally {
          bytes.fill(0);
        }
      }
    }
    prover.finishC(), await initializeBound4Shards(shards, input.createShardWorker, shardWidth, input.signal);
    let results = /* @__PURE__ */ new Map();
    for (let section of input.manifest.sections) {
      checkAbort(input.signal);
      let windowBits = section.curve === "G2" ? 11 : 13, windows = input.wasm.VantaM2MsmShard.totalWindows(windowBits);
      if (!Number.isSafeInteger(windows) || windows < 4 || windows > 64)
        throw Error("Vanta BOUND4 MSM window count is invalid");
      if ((await Promise.all(shards.map((s, i) => s.call("start", {
        curve: section.curve,
        windowBits,
        from: Math.floor(i * windows / 4),
        to: Math.floor((i + 1) * windows / 4),
        points: section.point_count
      })))).some((reply) => reply !== !0)) throw Error("Vanta BOUND4 worker section rejected");
      for (let chunk of section.chunks) {
        checkAbort(input.signal);
        let query = await input.readQueryChunk(section.id, chunk.offset, chunk.length);
        if (!(query instanceof Uint8Array) || query.length !== chunk.length || sha256(query).slice(2).toLowerCase() !== chunk.sha256.toLowerCase())
          throw Error("Vanta combined BOUND4 query hash mismatch");
        let scalars, digits;
        try {
          if (scalars = prover.scalarChunk(section.id, chunk.point_start, chunk.point_count), digits = input.wasm.vantaM2SignedDigits(scalars, windowBits), !(scalars instanceof Uint8Array) || scalars.length !== chunk.point_count * 32 || !(digits instanceof Int16Array) || digits.length !== chunk.point_count * windows)
            throw Error("Vanta combined BOUND4 signed-digit length mismatch");
          if ((await Promise.all(shards.map((s) => {
            let q = Uint8Array.from(query), d = digits.slice();
            return s.call("push", {
              query: q.buffer,
              digits: d.buffer,
              pointStart: chunk.point_start,
              pointCount: chunk.point_count
            }, [q.buffer, d.buffer]);
          }))).some((r) => r !== !0))
            throw Error("Vanta combined BOUND4 MSM chunk rejected");
        } finally {
          query.fill(0), scalars?.fill(0), digits?.fill(0);
        }
      }
      let parts = await Promise.all(shards.map((s) => s.call("finish", {})));
      if (parts.some((part) => !(part instanceof ArrayBuffer) || part.byteLength !== (section.curve === "G2" ? 64 : 32)))
        throw Error("Vanta BOUND4 MSM partial result encoding differs");
      let combined = new Uint8Array(parts.reduce((acc, p2) => acc + p2.byteLength, 0)), off = 0;
      for (let part of parts) {
        let bytes = new Uint8Array(part);
        combined.set(bytes, off), off += bytes.length, bytes.fill(0);
      }
      try {
        results.set(section.id, section.curve === "G2" ? input.wasm.vantaM2CombineG2(combined, 4) : input.wasm.vantaM2CombineG1(combined, 4));
      } finally {
        combined.fill(0);
      }
      input.onProgress?.(section.id);
    }
    let p = (section) => {
      let point = results.get(section);
      if (!point) throw Error("Vanta combined BOUND4 MSM is incomplete");
      return point;
    }, plain = (value) => value instanceof Map ? Object.fromEntries([...value].map(([key, item]) => [key, plain(item)])) : Array.isArray(value) ? value.map(plain) : value, proof = plain(prover.finishBound4(
      p("H"),
      p("L"),
      p("A"),
      p("B_G1"),
      p("B_G2")
    ));
    for (let point of results.values()) point.fill(0);
    let signalFields = proof.public_signals;
    if (proof.verified_locally !== !0 || !Array.isArray(signalFields) || signalFields.length !== profile.publicSignals || !signalFields.every((s) => typeof s == "string") || !isHexString(proof.proof, profile.committedWitnesses === 1 ? 1088 : 256) || profile.committedWitnesses === 1 && (proof.commitment_scheme !== "ccgroth16-policy-v1" || proof.committed_witnesses !== 1))
      throw Error("Vanta BOUND4 proof failed local verifier");
    return checkAbort(input.signal), proof;
  } finally {
    for (let shard of shards)
      try {
        shard.terminate();
      } catch {
      }
    try {
      prover.abortBound4();
    } finally {
      prover.free();
    }
  }
}
var FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n, canonicalField = (value) => typeof value == "string" && /^0x[0-9a-f]{64}$/u.test(value) && BigInt(value) < FR;
async function proveVantaFamilyStandardBound4InWallet(input) {
  let selected = selectVantaFamilyBound4Driver(input.descriptor, input.relation, input.width), aggregate = selected.relation === "payout-aggregate", enhanced = selected.relation === "enhanced-fee-partner", profile = {
    chainId: selected.chainId,
    familyTag: selected.familyTag,
    relation: input.relation,
    publicSignals: aggregate ? 13 : enhanced ? 41 : 40,
    constraints: aggregate ? 12002 : input.matrixManifest.constraints,
    witnesses: aggregate ? 9047 : input.matrixManifest.witness_variables,
    committedWitnesses: aggregate ? 0 : 1,
    domain: aggregate ? 16384 : 65536
  }, expected = input.expectedPublicSignals;
  if (!Array.isArray(expected) || expected.length !== profile.publicSignals || !expected.every(canonicalField) || (enhanced ? expected[34] !== selected.familyTag || BigInt(expected[0]) !== BigInt(selected.chainId) || BigInt(expected[6]) !== BigInt(input.width) || ![0n, 3n].includes(BigInt(expected[7])) : expected[expected.length - 2] !== selected.familyTag || BigInt(expected[expected.length - 1]) !== BigInt(selected.chainId) || !aggregate && (BigInt(expected[0]) !== BigInt(selected.chainId) || BigInt(expected[6]) !== BigInt(input.width) || (input.width === 0 ? BigInt(expected[7]) !== 2n : ![0n, 1n, 4n, 5n].includes(BigInt(expected[7]))))))
    throw Error("Vanta family BOUND4 expected statement differs from its domain or operation");
  let proof = await proveStandardBound4(input, profile, input.width === 32 ? 32 : 8), signals = proof.public_signals;
  if (proof.selected_proof_path !== "STREAM_BOUND4" || proof.relation !== input.relation || proof.chain_id !== selected.chainId || proof.family_tag !== selected.familyTag || !signals.every((signal, i) => canonicalField(signal) && signal === expected[i]))
    throw Error("Vanta family BOUND4 proof differs from the expected signed action");
  return input.onProgress?.("verified"), Object.freeze({
    ...proof,
    public_signals: Object.freeze([...signals]),
    research_only: !0,
    safe_for_funds: !1,
    verified_locally: !0,
    selected_proof_path: "STREAM_BOUND4"
  });
}

// packages/sdk/src/vanta/unified-gate0-full-bound4-browser.ts
var SECTIONS2 = ["H", "L", "A", "B_G1", "B_G2"], HASH2 = /^[0-9a-f]{64}$/i, FIELD = /^0x[0-9a-f]{64}$/i, LOCK = /^sha256:[0-9a-f]{64}$/i, MAX_MATRIX = 32 * 1024 * 1024, MAX_PACKAGE = 128 * 1024 * 1024, SHARD_POINTS = 512, FR2 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n, digest = (bytes) => sha2562(bytes).slice(2).toLowerCase(), fail = (problem) => {
  throw Error(`Vanta full BOUND4 ${problem}`);
}, checkAbort2 = (signal) => {
  signal?.aborted && fail("proof cancelled");
};
function requireHash(bytes, size, expected) {
  (!(bytes instanceof Uint8Array) || bytes.length !== size || !HASH2.test(expected) || digest(bytes) !== expected.toLowerCase()) && fail("artifact SHA-256 mismatch");
}
function pinnedJson(bytes, expected) {
  (!(bytes instanceof Uint8Array) || !HASH2.test(expected) || digest(bytes) !== expected.toLowerCase()) && fail("manifest SHA-256 mismatch");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail("manifest is invalid JSON");
  }
}
function validateKey(m, width, expected) {
  (!m || m.schema !== "stealthos-vanta-m2-ccgroth16-pk-v2" || m.version !== 2 || m.curve !== "BN254" || m.chunk_points !== 8192 || m.research_only !== !0 || m.safe_for_funds !== !1 || m.committed_witness_start !== 0 || m.committed_witness_count !== width || !HASH2.test(expected) || m.package_sha256?.toLowerCase() !== expected.toLowerCase() || !Number.isSafeInteger(m.package_bytes) || m.package_bytes < 1 || m.package_bytes > MAX_PACKAGE || !Array.isArray(m.sections) || m.sections.length !== 7) && fail("M2 key family is not approved");
  let order = ["fixed", ...SECTIONS2, "CW"], end = 0;
  for (let i = 0; i < order.length; ++i) {
    let s = m.sections[i], curve = order[i] === "fixed" ? "fixed" : order[i] === "B_G2" ? "G2" : "G1", pointWidth = curve === "fixed" ? 0 : curve === "G2" ? 128 : 64;
    (!s || s.id !== order[i] || s.curve !== curve || s.point_width !== pointWidth || s.offset !== end || !Number.isSafeInteger(s.length) || s.length < 1 || !HASH2.test(s.sha256) || !Array.isArray(s.chunks) || s.id === "fixed" && (s.point_count !== 0 || s.chunks.length !== 0 || s.length > 8192) || s.id !== "fixed" && (!Number.isSafeInteger(s.point_count) || s.point_count < 1 || s.point_count > 65536 || s.length !== s.point_count * pointWidth || !s.chunks.length) || s.id === "CW" && s.point_count !== width + 2) && fail("M2 key section is malformed");
    let point = 0, pos = s.offset;
    for (let c of s.chunks)
      (c.section_id !== s.id || c.point_start !== point || c.offset !== pos || !Number.isSafeInteger(c.point_count) || c.point_count < 1 || c.point_count > m.chunk_points || c.length !== c.point_count * pointWidth || !HASH2.test(c.sha256)) && fail("M2 query chunk is malformed"), point += c.point_count, pos += c.length;
    s.id !== "fixed" && (point !== s.point_count || pos !== s.offset + s.length) && fail("M2 key section is incomplete"), end += s.length;
  }
  return end !== m.package_bytes && fail("M2 key package length mismatch"), new Map(m.sections.map((s) => [s.id, s]));
}
function validateMatrix(m, width, expected, family) {
  (!m || m.schema !== "stealthos-vanta-gate0-offline-matrix-v2" || m.format_version !== 2 || m.relation !== `vanta-v8-epoch-private-fee-${width}x5-v1` || m.research_only !== !0 || m.safe_for_funds !== !1 || !HASH2.test(expected) || m.matrix_sha256?.toLowerCase() !== expected.toLowerCase() || !Number.isSafeInteger(m.matrix_file_bytes) || m.matrix_file_bytes > MAX_MATRIX || !Number.isSafeInteger(m.dictionary_bytes) || m.dictionary_bytes < 12 || m.dictionary_bytes > 262144 || m.dictionary_bytes >= m.matrix_file_bytes || !Number.isSafeInteger(m.constraints) || m.constraints < 1 || m.constraints > 65531 || m.instance_variables !== (family ? 7 : 5) || !Number.isSafeInteger(m.witness_variables) || m.witness_variables < width || m.witness_variables > 65536 || m.qap_domain_size !== (width === 8 ? 32768 : 65536) || !Number.isSafeInteger(m.block_rows) || m.block_rows < 1 || m.block_rows > 1024 || !Array.isArray(m.blocks) || m.blocks.length < 3 || m.blocks.length > 600) && fail("offline matrix is not approved");
  let offset = m.dictionary_bytes, id = 0, row = 0;
  for (let b of m.blocks)
    (b.matrix_id !== id || b.matrix !== ["A", "B", "C"][id] || b.row_start !== row || !Number.isSafeInteger(b.row_count) || b.row_count < 1 || b.row_count > m.block_rows || row + b.row_count > m.constraints || b.offset !== offset || !Number.isSafeInteger(b.length) || b.length < 1 || b.length > 1048576) && fail("offline matrix block is malformed"), row += b.row_count, offset += b.length, row === m.constraints && (++id, row = 0);
  (id !== 3 || offset !== m.matrix_file_bytes) && fail("offline matrix is incomplete");
}
async function proveVantaV8FullBound4InWallet(input) {
  input.width !== 8 && input.width !== 32 && fail("width must be 8 or 32");
  let selected = input.family ? selectVantaFamilyBound4Driver(
    input.family.descriptor,
    input.family.relation,
    input.width
  ) : null, chainId = selected?.chainId ?? 84532, kind = input.family?.relation === "exit" ? "exit" : "epoch";
  (!LOCK.test(input.approvedSetupLockSha256) || !FIELD.test(input.expectedPublicStatement) || !FIELD.test(input.expectedCheckpointRef) || !Number.isSafeInteger(input.expectedSourceEpoch) || input.expectedSourceEpoch < 0) && fail("trusted setup or wallet binding is invalid");
  let keyManifest = pinnedJson(input.m2ManifestBytes, input.approvedM2ManifestSha256), matrix = pinnedJson(
    input.matrixManifestBytes,
    input.approvedMatrixManifestSha256
  ), key = validateKey(keyManifest, input.width, input.approvedM2PackageSha256);
  validateMatrix(matrix, input.width, input.approvedMatrixSha256, selected !== null);
  let publicMaterial = input.publicMaterial;
  (!publicMaterial || typeof publicMaterial != "object" || publicMaterial.schema !== `vanta-v8-${kind}-${input.width}x5-gate1-public-material-v1` || publicMaterial.research_only !== !0 || publicMaterial.safe_for_funds !== !1 || publicMaterial.chain_id !== chainId || publicMaterial.table_n !== 65536 || publicMaterial.query_slots !== input.width || publicMaterial.setup_lock_sha256 !== input.approvedSetupLockSha256) && fail("Gate1 public material is not bound to the approved epoch family");
  let cache = input.authenticatedWalletCache;
  (!cache || typeof cache != "object" || cache.schema !== `vanta-v8-${kind}-${input.width}x5-wallet-caulk-cache-v1` || cache.research_only !== !0 || cache.safe_for_funds !== !1 || cache.chain_id !== chainId || cache.table_id !== input.expectedSourceEpoch || !Number.isSafeInteger(cache.slot_count) || Number(cache.slot_count) < 32 || Number(cache.slot_count) > 65536 || typeof cache.checkpoint_ref != "string" || cache.checkpoint_ref.toLowerCase() !== input.expectedCheckpointRef.toLowerCase() || !Array.isArray(cache.openings) || cache.openings.length !== input.width) && fail("wallet Caulk cache does not match the signed epoch checkpoint");
  let shards = [], prover = new input.wasm.VantaOfflineMatrixProver();
  try {
    checkAbort2(input.signal);
    for (let id of ["fixed", "CW"]) {
      let section = key.get(id), bytes = await input.readM2Chunk(section.offset, section.length);
      requireHash(bytes, section.length, section.sha256);
      try {
        id === "fixed" ? prover.loadM2Fixed(bytes, section.sha256) : prover.loadM2Cw(bytes, section.sha256);
      } finally {
        bytes.fill(0);
      }
    }
    let matrixHasher = incrementalSha256.create(), readVerified = async (offset, length, expected) => {
      checkAbort2(input.signal);
      let bytes = await input.readMatrixChunk(offset, length);
      return requireHash(bytes, length, expected), bytes;
    }, dictionary = await input.readMatrixChunk(0, matrix.dictionary_bytes);
    (!(dictionary instanceof Uint8Array) || dictionary.length !== matrix.dictionary_bytes) && fail("matrix dictionary length mismatch");
    let dictHash = digest(dictionary);
    matrixHasher.update(dictionary), dictionary.fill(0);
    let blockHashes = [];
    for (let block of matrix.blocks) {
      checkAbort2(input.signal);
      let bytes = await input.readMatrixChunk(block.offset, block.length);
      (!(bytes instanceof Uint8Array) || bytes.length !== block.length) && fail("matrix block length mismatch"), matrixHasher.update(bytes), blockHashes.push(digest(bytes)), bytes.fill(0);
    }
    Array.from(matrixHasher.digest(), (x) => x.toString(16).padStart(2, "0")).join("") !== matrix.matrix_sha256.toLowerCase() && fail("matrix full-file hash mismatch");
    let verifiedDict = await readVerified(0, matrix.dictionary_bytes, dictHash);
    try {
      prover.loadMatrixDictionary(verifiedDict);
    } finally {
      verifiedDict.fill(0);
    }
    let prepared = prover.beginOfflineMatrixV8Wallet(
      input.walletWitness,
      input.hashBinding,
      matrix.constraints,
      matrix.instance_variables,
      matrix.witness_variables,
      matrix.qap_domain_size
    ), assignment = matrix.instance_variables + matrix.witness_variables;
    (!prepared || prepared.constraints !== matrix.constraints || prepared.instance_variables !== matrix.instance_variables || prepared.witness_variables !== matrix.witness_variables || prepared.qap_domain_size !== matrix.qap_domain_size || prepared.full_assignment_len !== assignment || key.get("L").point_count !== matrix.witness_variables - input.width || SECTIONS2.filter((s) => s !== "H" && s !== "L").some((s) => key.get(s).point_count !== assignment)) && fail("Gate0 R1CS differs from the pinned 8x5/32x5 family");
    for (let id = 0; id < 3; ++id) {
      checkAbort2(input.signal), id === 2 && (prover.finishAB(), prover.beginC());
      for (let [index, block] of matrix.blocks.entries()) {
        if (block.matrix_id !== id) continue;
        let bytes = await readVerified(block.offset, block.length, blockHashes[index]);
        try {
          prover.applyMatrixBlock(id, block.row_start, block.row_count, bytes);
        } finally {
          bytes.fill(0);
        }
      }
    }
    prover.finishCPrepareM2(), await initializeBound4Shards(shards, input.createShardWorker, input.width, input.signal);
    for (let id of SECTIONS2) {
      checkAbort2(input.signal);
      let section = key.get(id), bits = section.curve === "G2" ? 11 : 13, windows = input.wasm.VantaM2MsmShard.totalWindows(bits);
      (!Number.isSafeInteger(windows) || windows < 1 || windows > 64) && fail("MSM window count differs from the existing shard protocol"), (await Promise.all(shards.map((s, i) => s.call("start", {
        curve: section.curve,
        windowBits: bits,
        points: section.point_count,
        from: Math.floor(i * windows / 4),
        to: Math.floor((i + 1) * windows / 4)
      })))).some((reply) => reply !== !0) && fail("MSM worker section rejected");
      for (let chunk of section.chunks) {
        checkAbort2(input.signal);
        let query = await input.readM2Chunk(chunk.offset, chunk.length);
        requireHash(query, chunk.length, chunk.sha256);
        try {
          for (let start = 0; start < chunk.point_count; start += SHARD_POINTS) {
            checkAbort2(input.signal);
            let count = Math.min(SHARD_POINTS, chunk.point_count - start), points = query.subarray(
              start * section.point_width,
              (start + count) * section.point_width
            ), scalars = prover.m2ScalarChunk(id, chunk.point_start + start, count), digits;
            try {
              (!(scalars instanceof Uint8Array) || scalars.length !== count * 32) && fail("MSM scalar chunk length mismatch"), digits = input.wasm.vantaM2SignedDigits(scalars, bits), (!(digits instanceof Int16Array) || digits.length !== count * windows) && fail("MSM signed digit length mismatch"), (await Promise.all(shards.map((shard) => {
                let q = Uint8Array.from(points), d = digits.slice();
                return shard.call("push", {
                  query: q.buffer,
                  digits: d.buffer,
                  pointStart: chunk.point_start + start,
                  pointCount: count
                }, [q.buffer, d.buffer]);
              }))).some((x) => x !== !0) && fail("MSM worker rejected a subchunk");
            } finally {
              scalars.fill(0), digits?.fill(0);
            }
          }
        } finally {
          query.fill(0);
        }
      }
      let partials = await Promise.all(shards.map((s) => s.call("finish", {})));
      partials.some((part) => !(part instanceof ArrayBuffer) || part.byteLength !== (section.curve === "G2" ? 64 : 32)) && fail("MSM partial result encoding differs");
      let bytes = new Uint8Array(partials.reduce((n, p) => n + p.byteLength, 0)), offset = 0;
      for (let part of partials) {
        let view = new Uint8Array(part);
        bytes.set(view, offset), offset += view.length, view.fill(0);
      }
      let point;
      try {
        point = section.curve === "G2" ? input.wasm.vantaM2CombineG2(bytes, 4) : input.wasm.vantaM2CombineG1(bytes, 4), prover.applyM2MsmResult(id, point);
      } finally {
        bytes.fill(0), point?.fill(0);
      }
      input.onProgress?.(id);
    }
    prover.finishM2Proof()?.verified !== !0 && fail("ccGroth16 Gate0 did not verify locally"), input.onProgress?.("gate0_verified");
    let bundle = prover.finishWalletFullBundle(
      input.publicMaterial,
      input.authenticatedWalletCache
    );
    if ((!bundle || bundle.schema !== `vanta-v8-${kind}-${input.width}x5-browser-three-proof-research-v1` || bundle.research_only !== !0 || bundle.safe_for_funds !== !1 || bundle.chain_id !== chainId || bundle.setup_lock_sha256 !== input.approvedSetupLockSha256 || bundle.checkpoint_ref?.toLowerCase() !== input.expectedCheckpointRef.toLowerCase() || bundle.source_epoch !== input.expectedSourceEpoch || bundle.gate0?.public_statement?.toLowerCase() !== input.expectedPublicStatement.toLowerCase() || [bundle.gate0, bundle.gate1, bundle.cp_link].some((x) => x?.browser_generated !== !0 || x?.verified_locally !== !0)) && fail("full three-proof bundle is not bound to the requested wallet action"), selected) {
      let signals = bundle.public_inputs ?? bundle.gate0.public_inputs;
      (bundle.family_tag !== selected.familyTag || !Array.isArray(signals) || signals.length !== 6 || !signals.every((value) => typeof value == "string" && FIELD.test(value) && BigInt(value) < FR2) || signals[4] !== selected.familyTag || BigInt(signals[5]) !== BigInt(selected.chainId)) && fail("family tag or chain differs from the selected driver");
      let checkedSignals = signals, nested = bundle.gate0.public_inputs;
      nested !== void 0 && (!Array.isArray(nested) || nested.length !== checkedSignals.length || nested.some((value, i) => value !== checkedSignals[i])) && fail("Gate0 public input transcripts disagree");
    }
    return checkAbort2(input.signal), input.onProgress?.("bundle_verified"), bundle;
  } finally {
    for (let shard of shards)
      try {
        shard.terminate();
      } catch {
      }
    try {
      prover.abortSession();
    } finally {
      prover.free();
    }
  }
}

// packages/sdk/src/vanta/unified-browser-bound4-workers.ts
var HASH3 = /^[0-9a-f]{64}$/iu;
function createVantaBrowserBound4WorkerFactory(release, artifacts) {
  let runtime = globalThis;
  if (release?.researchOnly !== !0 || release.profileName !== "8x5" && release.profileName !== "32x5" || !HASH3.test(release.glueSha256) || !HASH3.test(release.wasmSha256) || typeof release.glueUrl != "string" || typeof release.wasmUrl != "string" || typeof runtime.Worker != "function" || !runtime.location)
    throw Error("Vanta browser BOUND4 requires a pinned research release and Web Workers");
  let root = runtime.location;
  if (root.protocol !== "https:" && !(root.protocol === "http:" && (root.hostname === "localhost" || root.hostname === "127.0.0.1")))
    throw Error("Vanta browser BOUND4 requires a secure same-origin context");
  let glue = new URL(release.glueUrl, root.href), wasm = new URL(release.wasmUrl, root.href);
  if (glue.origin !== wasm.origin || !(glue.protocol === "https:" || glue.origin === root.origin && glue.protocol === "http:") || !glue.pathname.endsWith(".js") || !wasm.pathname.endsWith(".wasm") || glue.username || glue.password || wasm.username || wasm.password || glue.search || glue.hash || wasm.search || wasm.hash)
    throw Error("Vanta BOUND4 WASM and glue must use pinned secure URLs on one artifact origin");
  let config = Object.freeze({
    type: "vanta-bound4-bootstrap",
    researchOnly: !0,
    profileName: release.profileName,
    glueUrl: glue.href,
    wasmUrl: wasm.href,
    glueSha256: release.glueSha256.toLowerCase(),
    wasmSha256: release.wasmSha256.toLowerCase()
  }), pinned = artifacts ? { glue: artifacts.glue.slice(), wasm: artifacts.wasm.slice() } : void 0;
  return () => {
    let worker = new runtime.Worker(new URL("./unified-bound4-bootstrap-worker.js", import.meta.url), {
      type: "module"
    }), ready = !1, stopped = !1, queue = [], listeners = { message: /* @__PURE__ */ new Set(), error: /* @__PURE__ */ new Set() }, fail3 = (message = "Vanta pinned BOUND4 worker failed") => {
      if (!stopped) {
        stopped = !0, queue.length = 0;
        for (let cb of listeners.error) cb({ error: Error(message) });
        worker.terminate();
      }
    };
    if (worker.addEventListener("error", () => fail3()), worker.addEventListener("message", (event) => {
      let data = event.data;
      if (data?.type === "vanta-bound4-fatal") {
        fail3(data.reason === "memory" ? "Vanta worker memory exhausted" : "Vanta worker bootstrap failed");
        return;
      }
      if (data?.type === "vanta-bound4-ready") {
        if (ready || data.profileName !== release.profileName) {
          fail3();
          return;
        }
        ready = !0;
        for (let item of queue) worker.postMessage(item.message, item.transfer);
        queue.length = 0;
        return;
      }
      if (!ready) {
        fail3();
        return;
      }
      for (let cb of listeners.message) cb(event);
    }), pinned) {
      let glueBytes = pinned.glue.slice(), wasmBytes = pinned.wasm.slice();
      worker.postMessage({ ...config, glueBytes, wasmBytes }, [glueBytes.buffer, wasmBytes.buffer]);
    } else worker.postMessage(config);
    return Object.freeze({
      postMessage(message, transfer) {
        if (stopped) throw Error("Vanta BOUND4 worker terminated");
        if (ready) worker.postMessage(message, transfer);
        else {
          if (queue.length >= 16) throw Error("Vanta BOUND4 bootstrap overflow");
          queue.push({ message, transfer });
        }
      },
      addEventListener(type, callback) {
        listeners[type].add(callback);
      },
      removeEventListener(type, callback) {
        listeners[type].delete(callback);
      },
      terminate() {
        stopped || (stopped = !0, queue.length = 0, worker.terminate());
      }
    });
  };
}

// packages/sdk/src/vanta/public-artifact-reader.ts
import { sha256 as sha2563 } from "ethers";
var HASH4 = /^[a-f0-9]{64}$/iu, MAX_RANGE = 2 * 1024 * 1024, fail2 = () => {
  throw Error("Vanta pinned public artifact unavailable or invalid");
}, VantaPublicArtifactIntegrityError = class extends Error {
  constructor() {
    super("Vanta public artifact SHA-256 mismatch"), this.name = "VantaPublicArtifactIntegrityError";
  }
};
function createVantaPinnedPublicArtifactReader(input) {
  let base = new URL(input.baseUrl), local = input.allowLocalhostHttp === !0 && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if (base.protocol !== "https:" && !local || base.username || base.password || base.search || base.hash || input.credentials !== void 0 && !["omit", "same-origin"].includes(input.credentials))
    throw Error("Vanta public artifacts require a credential-free HTTPS base URL");
  base.pathname.endsWith("/") || (base.pathname += "/");
  let url = (path) => {
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(path) || path.split("/").some((v) => v === "." || v === "..")) return fail2();
    let result = new URL(path, base);
    return result.origin !== base.origin || !result.pathname.startsWith(base.pathname) ? fail2() : result.href;
  }, fetchBytes = async (path, maxBytes, range) => {
    if (input.signal?.aborted) throw Error("Vanta proof cancelled");
    let response;
    try {
      response = await (input.fetcher ?? fetch)(url(path), {
        credentials: input.credentials ?? "omit",
        redirect: "error",
        signal: input.signal,
        ...range ? { headers: { Range: "bytes=" + range.offset + "-" + (range.offset + range.length - 1) } } : {}
      });
    } catch {
      if (input.signal?.aborted) throw Error("Vanta proof cancelled");
      return fail2();
    }
    if (response.redirected || response.type === "opaque" || response.status !== (range ? 206 : 200) || range && response.headers.get("content-range") !== "bytes " + range.offset + "-" + (range.offset + range.length - 1) + "/" + range.total) return fail2();
    let size = response.headers.get("content-length");
    if (size !== null && (!/^[0-9]+$/u.test(size) || Number(size) > maxBytes || range && Number(size) !== range.length)) return fail2();
    let reader = response.body?.getReader();
    if (!reader) return fail2();
    let parts = [], length = 0;
    try {
      for (; ; ) {
        let item = await reader.read();
        if (item.done) break;
        if (length += item.value.byteLength, length > maxBytes)
          return await reader.cancel(), fail2();
        parts.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (length < 1 || range && length !== range.length) return fail2();
    let bytes = new Uint8Array(length), position = 0;
    for (let part of parts)
      bytes.set(part, position), position += part.byteLength;
    return bytes;
  };
  return Object.freeze({
    url,
    async read(path, expected, maxBytes) {
      if (!HASH4.test(expected) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) return fail2();
      let bytes = await fetchBytes(path, maxBytes);
      if (sha2563(bytes).slice(2).toLowerCase() !== expected.toLowerCase())
        throw bytes.fill(0), new VantaPublicArtifactIntegrityError();
      return bytes;
    },
    async range(path, offset, length, total) {
      return !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_RANGE || !Number.isSafeInteger(total) || total < 1 || total > 128 * 1024 * 1024 || offset + length > total ? fail2() : fetchBytes(path, length, { offset, length, total });
    }
  });
}

// packages/sdk/src/vanta/unified-browser-bound4-runtime.ts
var HASH5 = /^[0-9a-f]{64}$/iu;
async function initializeVantaBrowserBound4ResearchRuntime(input) {
  let runtime = globalThis;
  if (!runtime.crypto?.subtle || !runtime.location)
    throw Error("Vanta browser proving requires secure WebCrypto.");
  let load = async (url, expected, maxBytes) => {
    if (!HASH5.test(expected)) throw Error("Invalid Vanta trusted release pin.");
    let u = new URL(url, runtime.location.href);
    if (!(u.protocol === "https:" || u.origin === runtime.location.origin && u.protocol === "http:") || u.username || u.password || u.search || u.hash)
      throw Error("Vanta browser artifact must use a secure configured origin.");
    if (input.signal?.aborted) throw Error("Vanta browser proving cancelled.");
    let reader = createVantaPinnedPublicArtifactReader({
      baseUrl: u.origin + "/",
      fetcher: input.fetcher,
      signal: input.signal,
      credentials: "omit",
      allowLocalhostHttp: !0
    }), bytes;
    try {
      bytes = await reader.read(u.pathname.slice(1), expected, maxBytes);
    } catch (error) {
      throw error instanceof VantaPublicArtifactIntegrityError ? Error("Vanta browser artifact SHA-256 mismatch.") : input.signal?.aborted ? Error("Vanta browser proving cancelled.") : Error("Vanta pinned browser artifact unavailable or invalid.");
    }
    if (bytes.length < 1e3 || bytes.length > maxBytes)
      throw Error("Vanta browser artifact size invalid.");
    return bytes;
  }, [glue, wasmBytes] = await Promise.all([
    load(input.release.glueUrl, input.release.glueSha256, 5e5),
    load(input.release.wasmUrl, input.release.wasmSha256, 2e7)
  ]);
  if (input.signal?.aborted)
    throw glue.fill(0), wasmBytes.fill(0), Error("Vanta browser proving cancelled.");
  let objectUrl = URL.createObjectURL(new Blob([new Uint8Array(glue)], { type: "text/javascript" }));
  try {
    let module = await import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      objectUrl
    );
    if (typeof module.default != "function" || typeof module.VantaOfflineMatrixProver != "function" || typeof module.vantaM2SignedDigits != "function" || typeof module.vantaM2CombineG1 != "function" || typeof module.vantaM2CombineG2 != "function" || typeof module.VantaM2MsmShard?.totalWindows != "function")
      throw Error("Vanta pinned browser prover exports differ from release.");
    if (await module.default({ module_or_path: wasmBytes }), input.signal?.aborted) throw Error("Vanta browser proving cancelled.");
    return Object.freeze({ wasm: module, createShardWorker: createVantaBrowserBound4WorkerFactory(input.release, { glue, wasm: wasmBytes }) });
  } finally {
    URL.revokeObjectURL(objectUrl), glue.fill(0), wasmBytes.fill(0);
  }
}

// packages/vanta-sdk/fresh/family-proof-entry.ts
async function proveVantaFamilyBound4InWallet(input) {
  let selected = selectVantaFamilyBound4Driver(input?.descriptor, input?.relation, input?.width), environment = globalThis;
  if (typeof environment.DedicatedWorkerGlobalScope != "function" || !(globalThis instanceof environment.DedicatedWorkerGlobalScope) || environment.document !== void 0)
    throw Error("Family STREAM_BOUND4 must run in a dedicated local browser proof worker.");
  return input.signal?.throwIfAborted(), input.onSelectedDriver?.(selected), input.relation === "normal" || input.relation === "exit" ? proveVantaV8FullBound4InWallet({
    ...input,
    family: { descriptor: input.descriptor, relation: input.relation }
  }) : proveVantaFamilyStandardBound4InWallet(input);
}
function selectVantaFamilyOperationProofs(descriptor, operation, width) {
  validateVantaFamilyBound4Descriptor(descriptor);
  let relations;
  if (operation === "deposit" && width === 0) relations = ["combined-fee-partner"];
  else if ((operation === "privateSend" || operation === "withdraw") && (width === 8 || width === 32))
    relations = ["combined-fee-partner", "normal"];
  else if (operation === "exit" && (width === 8 || width === 32)) relations = ["exit"];
  else if (operation === "aggregate" && width === 0) relations = ["payout-aggregate"];
  else throw Error("Unsupported family wallet operation or proof width.");
  return Object.freeze(relations.map((relation) => selectVantaFamilyBound4Driver(descriptor, relation, width)));
}
export {
  VANTA_DOGEOS_FAMILY_TAG,
  createVantaBrowserBound4WorkerFactory,
  initializeVantaBrowserBound4ResearchRuntime,
  proveVantaFamilyBound4InWallet,
  selectVantaFamilyBound4Driver,
  selectVantaFamilyOperationProofs,
  validateVantaFamilyBound4Descriptor
};
