# DogeOS family proof runtime

The `@stealthos/vanta-sdk/family-proofs` entry point provides local proof methods for the DogeOS family. Every funded proof selects `STREAM_BOUND4` and exactly four local MSM workers. The implementation reuses the existing Gate0 and combined-fee schedulers, with an explicit aggregate constructor. It never invokes a whole-key funded prover, snarkjs funded prover, remote prover, or a fallback selected by the caller.

This integration prerelease is **unconfigured**. The current qualification keys are disposable public-seed test material, and proof results retain `research_only:true` and `safe_for_funds:false`. Genuine desktop proof rehearsal establishes the selected implementation and equations. A completed family ceremony, independently reviewed final-key resource build, signed network activation, immutable deployed verifier graph and partner device acceptance are still required before any funded delivery claim.

## Public proof methods

`createVantaFamilyProofRuntime` takes a read provider, a same-origin artifact base URL, an optional fetch adapter, an AbortSignal and public progress callbacks. It accepts no caller-selected release, generation, circuit, key, driver or worker count. Initialization must occur in a dedicated browser proof worker before any WASM or artifact loading. It is suitable for a trusted local WebView only if MyDoge approves that host architecture.

| Method | Required local relation |
| --- | --- |
| `proveDeposit` | Combined fee/partner, 39 signals, mode 2 and width 0 |
| `provePrivateSend` | Combined fee/partner and normal three-gate proof, width 8 or 32 |
| `proveWithdrawal` | Combined fee/partner and normal three-gate proof, width 8 or 32 |
| `proveExit` | Exit three-gate proof, width 8 or 32 |
| `proveAggregation` | Payout aggregation, 13 signals |
| `prove` | One explicitly selected supported relation and width |

Standard requests contain `walletWitness` and every `expectedPublicSignals` value. The trusted wallet must assemble these expectations from its verified signed action. The SDK compares all 13 or 39 values, including family tag, chain, mode and width. Gate0 requests contain the local witness, hash binding, authenticated wallet cache, expected public statement, checkpoint and epoch. The SDK loads the pinned public material itself.

These are proof methods. They do not finish account-scoped note selection, fee quote authorization, atomic transaction construction, settlement/reconciliation, MuchFi swap settlement or CCIP destination delivery. Native application handlers must implement those operations before advertising their corresponding host capabilities. A successful local proof is not a transaction receipt.

Owner and handle credential proofs are separate onboarding relations. They are not selectable as funded STREAM_BOUND4 roles. The existing auxiliary credential rehearsal must be reported separately and cannot satisfy the four-worker funded proof gate.

## Sealed v2 release

A funded loader requires `stealthos-family-sdk-release-v2`. Its usual setup, signed activation, signed deployment lock, pins and reviewed network policy are unchanged. Its mandatory `proving` field contains:

- `driver`: the exact `stealthos-family-bound4-driver-v1` descriptor for family `dogeos`, network `eip155:6281971`, the deterministic family tag, engine `STREAM_BOUND4` and worker count 4.
- `resourcesSha256`: the independently reviewed hash of the compiled public resource inventory.
- `circuits`: the exact sorted eight circuit rows, each containing `id`, `r1csSha256`, `sourceSha256` and `familyTag`. Their canonical hash must equal `setup.circuitInventorySha256` from the signed setup.

Older v1 descriptors remain valid for read-only release checks. They cannot initialize this funded proof runtime. An unconfigured source build fails before any wallet secret is opened.

The resource inventory is `stealthos-family-bound4-resources-v1`, bound to the exact family, network, setup, generation and source commit. It has six fixed profiles: normal8, normal32, exit8, exit32, aggregate and combined. Every file reference contains a contained relative path, SHA-256 and byte length. Each profile's R1CS digest must match the signed circuit inventory.

Gate0 profiles pin runtime glue/WASM, M2 manifest/package, offline matrix manifest/data, Gate1 public material and setup lock. Standard profiles pin runtime glue/WASM, R1CS and source-key digest, key manifest, fixed verification material, five separate query files and offline matrix manifest/data. There is no whole-key loading field. Aggregate and combined reuse the exact normal8 runtime bytes.

The release compiler is:

```sh
node packages/vanta-sdk/scripts/compile-family-proof-resources.mjs \
  RELEASE_JSON RELEASE_FILE_SHA256 \
  INVENTORY_JSON INVENTORY_FILE_SHA256 \
  ARTIFACT_DIRECTORY OUTPUT_DIRECTORY
```

The compiler validates signed release identity, all artifact bytes, standard query/dictionary/block hashes, Gate0 M2 section/chunk hashes and Gate0 matrix dimensions/contiguous block coverage under its complete-file digest. It emits the two generated compiled modules. It never signs authority messages or creates ceremony keys. Genuine source/R1CS/key derivation verification remains part of the family ceremony exporter and qualification package.

Runtime reads require exact 206 responses for bounded ranges. They reject redirects, cross-origin loading, size mismatches and full-file fallback responses. Standard chunks are checked against the pinned manifest. The Gate0 engine first authenticates the entire matrix in bounded memory, then checks every block against the first-pass digest before using it.

## Lifecycle and host integration

The runtime permits one operation at a time. It verifies the compiled signed activation/deployment before initialization, immediately before proving and again before returning the result. Cancellation is checked after proof generation and after the final verification. A chain/context change or late cancellation discards the result.

Main WASM modules are cached only by exact compiled glue/WASM digests, with at most four entries. Each proof creates four fresh shard workers, requires successful initialization and each section reply, and terminates all four in its cleanup path. Every shard request has a bounded response timeout. Scalar and signed-digit buffers are cleared after transfer. A failed or cancelled operation disposes the runtime and requires host worker restart.

`dispose()` cancels active work and drops module references. To reclaim browser module/WASM memory deterministically, the native host must terminate the owning proof worker on disposal, lock, backgrounding, account change or crash. Create a new runtime and reconcile durable pending transactions before the next write, using the existing host-worker protocol. No performance or memory limit on iOS/Android is established by desktop tests.

`createVantaFamilyHostRuntimeFactory` accepts optional `proofArtifacts` containing only `artifactBaseUrl` and `fetcher`. It supplies the verified fixed `proofs` runtime to the trusted `initializeRuntime` callback. The factory refuses funded host capabilities without this runtime. The handler must use these proof methods and expose only operations actually implemented for its verified generation.

The module is ESM and has no React, Wagmi, MyDoge browser global, social login or wallet seed dependency. Existing standalone EIP-1193 adapters and native host adapters remain separate from proving. MyDoge's actual framework, accepted local prover boundary and build/secure-storage interfaces still require partner agreement and real iOS/Android integration access.

## Qualification evidence

The low-level `@stealthos/vanta-sdk/family-proof-driver` export uses the same fixed dispatch and schedulers. The rehearsal harness supplies measured disposable artifacts and explicitly records that no signed network activation is installed. `onSelectedDriver` reports only public engine, relation, width, family and chain metadata. It is not proof of worker execution by itself: acceptance independently observes all four real browser workers, pinned initialization, transferred chunks, replies and termination, then verifies the resulting proof in the EVM.
