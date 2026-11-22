/** Actual existing normal STREAM_BOUND4 and public KZG opening operations.
 * All artifacts come from the compiled candidate inventory, including the
 * complete public opening corpus. Private row choices remain in this worker. */
import {getCompiledFamilyEvmRelease} from "./family-network.mjs";
import {getCompiledVantaFamilyProofResources} from "./family-proof-resources.mjs";
import {selectVantaFamilyFundingResources,validateVantaFamilyNoteOpeningMetadata,validateVantaFamilyPublicCacheBuild} from "./family-funding-resources.mjs";
import { createVantaFamilyProofArtifactReader, assertVantaFamilyStreamManifestPins } from "./family-proof-resources.mjs";
import { proveVantaFamilyBound4InWallet } from "./family-proof-driver.mjs";
import { initializeFamilyProofModule } from "./family-proof-module.mjs";
import { assertFamilyProofEnvironment, loadFamilyProofModule } from "#vanta-family-proof-platform";
import { enhancedField, enhancedFail, enhancedWord } from "./family-enhanced-wire.mjs";

const engines = new WeakSet();
export const isVantaEnhancedFundingRuntime = value => engines.has(value);
const parse = bytes => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } finally { bytes.fill(0); } };
const json = raw => { if (typeof raw !== "string" || raw.length > 4 * 1024 * 1024) enhancedFail(); return JSON.parse(raw); };
const FQ = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export function compressEnhancedCheckpoint({ x, y }) {
  x = BigInt(x); y = BigInt(y);
  if (x < 0n || x >= FQ || y < 0n || y >= FQ || y * y % FQ !== (x * x % FQ * x + 3n) % FQ) enhancedFail();
  const bytes = x.toString(16).padStart(64, "0").match(/../gu).reverse();
  if (y > FQ - y) bytes[31] = (parseInt(bytes[31], 16) | 128).toString(16).padStart(2, "0");
  return "0x" + bytes.join("");
}
export async function createVantaEnhancedFundingRuntime({ artifactBaseUrl, fetcher, signal, onProgress, asset="native",releaseContext } = {}) {
  assertFamilyProofEnvironment();
  const release=getCompiledFamilyEvmRelease(releaseContext),inventory=getCompiledVantaFamilyProofResources(release,releaseContext);
  const resources=selectVantaFamilyFundingResources(release,inventory,asset),descriptor=release.proving.driver;
  const reader = createVantaFamilyProofArtifactReader({ artifactBaseUrl, fetcher, signal });
  const runtimes = new Map(); let cachePromise, disposed = false, busy = false;
  const live = () => { signal?.throwIfAborted(); if (disposed) enhancedFail(); };
  const abort = () => { disposed = true; runtimes.clear(); };
  signal?.addEventListener("abort", abort, { once: true });
  async function normal(width,relation="normal") {
    live(); if (![8, 32].includes(width)||!["normal","exit"].includes(relation)) enhancedFail();
    const runtimeKey=relation+width;
    if (!runtimes.has(runtimeKey)) runtimes.set(runtimeKey, (async () => {
      const profile = resources.profiles[`${relation}${width}`];
      const [runtime, keyBytes, matrixBytes, materialBytes] = await Promise.all([
        initializeFamilyProofModule({ reader, runtime: profile.runtime, profileName: `${width}x5`, signal }), reader.bytes(profile.m2Manifest),
        reader.bytes(profile.matrixManifest), reader.bytes(profile.publicMaterial),
      ]);
      const key = parse(keyBytes), matrix = parse(matrixBytes), material = parse(materialBytes);
      assertVantaFamilyStreamManifestPins({ name: `${relation}${width}`, profile, key, matrix, driver: descriptor });
      live(); return { ...runtime, profile, key, material };
    })().catch(error=>{runtimes.delete(runtimeKey);throw error;}));
    return runtimes.get(runtimeKey);
  }
  async function cache() {
    live();
    cachePromise ??= (async () => {
      const p = resources.publicCache;
      const [glue, wasm, corpus, metadataBytes, buildBytes] = await Promise.all([
        reader.bytes(p.runtime.glue), reader.bytes(p.runtime.wasm), reader.bytes(p.corpus), reader.bytes(p.metadata), reader.bytes(p.runtime.build),
      ]);
      const metadata = validateVantaFamilyNoteOpeningMetadata(parse(metadataBytes),p.corpus);
      const expectedBuild=validateVantaFamilyPublicCacheBuild(parse(buildBytes),p,metadata,resources.chainId);
      let engine;
      try { engine = await loadFamilyProofModule(glue, wasm); }
      finally { glue.fill(0); wasm.fill(0); }
      if (!["buildVantaV8UnifiedPublicCaulkCache", "buildVantaV8UnifiedPublicRowKeys","vantaV8UnifiedPublicCacheBuildInfo"].every(k => typeof engine[k] === "function")) enhancedFail();
      const actualBuild=json(engine.vantaV8UnifiedPublicCacheBuildInfo());
      if(Object.keys(actualBuild).sort().join()!==Object.keys(expectedBuild).sort().join()||
        Object.entries(expectedBuild).some(([key,value])=>actualBuild[key]!==value))enhancedFail();
      live(); return { engine, corpus, metadata };
    })().catch(error=>{cachePromise=undefined;throw error;});
    return cachePromise;
  }
  const result = Object.freeze({ resources, engine: "STREAM_BOUND4", workerCount: 4, candidateOnly: true, safeForFunds: false,
    async warm({width=8}={}) { live(); await Promise.all([normal(width),cache()]); live(); },
    async noteEngine() {
      const { wasm, profile } = await normal(8);
      return Object.freeze({ glueSha256: profile.runtime.glue.sha256, wasmSha256: profile.runtime.wasm.sha256,
        ...Object.fromEntries(["createVantaFamilyOwnedNote", "createVantaFamilyRecipientNote", "verifyVantaFamilyOwnedNote", "verifyVantaFamilyRecipientNote"]
          .map(name => { if (typeof wasm[name] !== "function") enhancedFail(); return [name, request => wasm[name](request)]; })) });
    },
    async preview({ width, walletWitness, hashBinding,relation="normal" }) {
      const { wasm, key } = await normal(width,relation);
      const witness = { ...walletWitness, expected_gate0_vk_sha256: key.gate0_vk_compressed_sha256,
        expected_cw_uncompressed_sha256: key.gate0_cw_uncompressed_sha256 };
      const action = json(wasm.vantaV8PublicAction(witness, hashBinding));
      if (action.schema !== `vanta-v8-${relation==="exit"?"exit":"epoch"}-browser-public-action-v1` || action.chain_id !== resources.chainId ||
          action.width !== width || action.safe_for_funds !== false || action.research_only !== true ||
          action.source_epoch !== Number(BigInt(witness.action.source_table)) || action.target_epoch !== Number(BigInt(witness.action.target_table)) ||
          action.checkpoint_ref !== witness.checkpoint_ref || action.output_commitments.length !== 5 || action.nullifiers.length !== width ||
          action.input_commitments.length !== width || action.public_amount_hash !== hashBinding.public_amount_hash) enhancedFail();
      [...action.nullifiers, ...action.input_commitments, ...action.output_commitments, action.public_statement].forEach(v => enhancedField(v));
      live(); return { walletWitness: witness, action };
    },
    async amountCommitment({ amountAtomic, amountSalt, digest }) {
      const { wasm } = await normal(8);
      const value = wasm.vantaV8AmountCommitment(enhancedField(amountAtomic), enhancedField(amountSalt), enhancedField(digest), 0);
      live(); return enhancedField(value);
    },
    async provePublicTotal({ walletWitness, expectedPublicSignals }) {
      live(); if (busy) enhancedFail(); busy = true;
      try {
        const { wasm, createShardWorker } = await normal(8), profile = resources.profiles.aggregate;
        const [keyBytes, matrixBytes] = await Promise.all([reader.bytes(profile.keyManifest), reader.bytes(profile.matrixManifest)]);
        const key = parse(keyBytes), matrix = parse(matrixBytes);
        assertVantaFamilyStreamManifestPins({ name: "aggregate", profile, key, matrix, driver: descriptor });
        const fixedKey = await reader.bytes(profile.fixedKey);
        try {
          const result = await proveVantaFamilyBound4InWallet({ descriptor, relation: "payout-aggregate", width: 0, wasm,
            createShardWorker, walletWitness, expectedPublicSignals,
            manifest: key, approvedKeySha256: profile.provingKeySha256, fixedKey, matrixManifest: matrix,
            approvedMatrixSha256: profile.matrix.sha256, signal, onProgress,
            readMatrixChunk: (offset, length) => reader.range(profile.matrix, offset, length),
            readQueryChunk: (section, offset, length) => reader.range(profile.queries[section], offset, length) });
          live(); return result;
        } finally { fixedKey.fill(0); }
      } finally { busy = false; }
    },
    async publicCache({ snapshot, rows, queryRows,relation="normal" }) {
      if(!["normal","exit"].includes(relation))enhancedFail();
      const { engine, corpus, metadata } = await cache();
      const value = json(engine.buildVantaV8UnifiedPublicCaulkCache(corpus, {
        schema: "vanta-v8-unified-public-caulk-cache-request-v1", chain_id: resources.chainId,
        table_id: snapshot.epoch, slot_count: snapshot.rows, checkpoint_ref: snapshot.checkpoint,
        checkpoint_commitment_g1: compressEnhancedCheckpoint(snapshot), tau_g1: metadata.tauG1, h_g2: metadata.hG2,
        rows, query_rows: queryRows,
      }));
      if (value.schema !== `vanta-v8-epoch-${queryRows.length}x5-wallet-caulk-cache-v1` || value.chain_id !== resources.chainId ||
          value.table_id !== snapshot.epoch || value.slot_count !== snapshot.rows || value.checkpoint_ref !== snapshot.checkpoint ||
          value.safe_for_funds !== false || value.openings.length !== queryRows.length ||
          value.openings.some((v, i) => v.value !== rows[queryRows[i]])) enhancedFail();
      live(); return relation==="exit"?{...value,schema:`vanta-v8-exit-${queryRows.length}x5-wallet-caulk-cache-v1`}:value;
    },
    async rowKeys(startRow,count=5) {
      if(!Number.isSafeInteger(startRow)||startRow<32||!Number.isSafeInteger(count)||count<1||count>5||startRow+count>65536)enhancedFail();
      const { engine, corpus, metadata } = await cache();
      const result = json(engine.buildVantaV8UnifiedPublicRowKeys(corpus, startRow, count));
      if (result.schema !== "vanta-v8-unified-public-row-keys-v1" || result.chainId !== resources.chainId ||
          result.lagRoot !== metadata.lagRoot || result.startRow !== startRow || result.rowCount !== count || result.keys.length !== count ||
          result.keys.some((v, i) => v.row !== startRow + i)) enhancedFail();
      live(); return result.keys.map(({ row: _row, ...key }) => key);
    },
    async prove({ width, walletWitness, hashBinding, authenticatedWalletCache, expectedPublicStatement, expectedCheckpointRef, expectedSourceEpoch,relation="normal" }) {
      live(); if (busy) enhancedFail(); busy = true;
      try {
        const { wasm, profile, createShardWorker, material } = await normal(width,relation);
        const [m2ManifestBytes, matrixManifestBytes] = await Promise.all([reader.bytes(profile.m2Manifest), reader.bytes(profile.matrixManifest)]);
        try {
          const bundle = await proveVantaFamilyBound4InWallet({ descriptor, relation, width, wasm,
            createShardWorker, walletWitness, hashBinding,
            authenticatedWalletCache, expectedPublicStatement, expectedCheckpointRef, expectedSourceEpoch,
            m2ManifestBytes, approvedM2ManifestSha256: profile.m2Manifest.sha256, approvedM2PackageSha256: profile.m2Key.sha256,
            matrixManifestBytes, approvedMatrixManifestSha256: profile.matrixManifest.sha256, approvedMatrixSha256: profile.matrix.sha256,
            approvedSetupLockSha256: profile.setupLockSha256, publicMaterial: material, signal, onProgress,
            readM2Chunk: (offset, length) => reader.range(profile.m2Key, offset, length),
            readMatrixChunk: (offset, length) => reader.range(profile.matrix, offset, length) });
          live(); return bundle;
        } finally { m2ManifestBytes.fill(0); matrixManifestBytes.fill(0); }
      } finally { busy = false; }
    },
    dispose() { abort(); signal?.removeEventListener("abort", abort); cachePromise?.then(v => v.corpus.fill(0)).catch(() => {}); },
  });
  engines.add(result); return result;
}
