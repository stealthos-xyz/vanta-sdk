/** Load one immutable ESM/WASM pair for either supported local host. Query
 * and matrix streaming, witnesses and proof verification remain shared. */
import { assertFamilyProofEnvironment, loadFamilyProofModule, createFamilyProofWorkerFactory }
  from "#vanta-family-proof-platform";

export async function initializeFamilyProofModule({ reader, runtime, profileName, signal }) {
  assertFamilyProofEnvironment();
  const release = Object.freeze({ researchOnly: true, profileName,
    glueUrl: reader.url(runtime.glue), wasmUrl: reader.url(runtime.wasm),
    glueSha256: runtime.glue.sha256, wasmSha256: runtime.wasm.sha256 });
  let glue, bytes;
  try {
    [glue, bytes] = await Promise.all([reader.bytes(runtime.glue), reader.bytes(runtime.wasm)]);
    signal?.throwIfAborted();
    if (glue.length < 1000 || glue.length > 500000 || bytes.length < 100000 || bytes.length > 20000000)
      throw Error("Family proof module exceeds its fixed bounds.");
    const createShardWorker = createFamilyProofWorkerFactory(release, glue, bytes);
    const wasm = await loadFamilyProofModule(glue, bytes);
    signal?.throwIfAborted();
    if (typeof wasm.VantaOfflineMatrixProver !== "function" || typeof wasm.VantaM2MsmShard?.totalWindows !== "function" ||
        typeof wasm.VantaM2MsmShard !== "function" || typeof wasm.vantaM2SignedDigits !== "function" ||
        typeof wasm.vantaM2CombineG1 !== "function" || typeof wasm.vantaM2CombineG2 !== "function")
      throw Error("Family proof module differs from the pinned engine.");
    return Object.freeze({ wasm, createShardWorker });
  } finally { glue?.fill(0); bytes?.fill(0); }
}
