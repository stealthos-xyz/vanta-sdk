# StealthOS SDK 0.3.0 recovery acceptance

Source draft completed on November 15, 2026 (America/Coral_Harbour), from
checkpoint `7a4893298b19dead3f735a7065e7281a43470053`. Package import remains
`@stealthos/vanta-sdk`. Generated release, proof inventory and catalog files
remain unconfigured until SOW 1 seals a real deployment. This source package
does not replace the live 0.2.0 SDK.

## Changes

- Portable withdrawal journals now validate their amounts, source, nonce,
  selected nullifiers, calldata hash and decoded quote before adoption.
- Multi-row backup reservation is one CAS operation. Conflicts cannot leave a
  partial import. Interrupted journal adoption retains armed notes; retrying
  the same backup repairs the journal without dispatching its transactions.
- Cancellation commits a failed journal state before releasing unsigned notes.
  Submission requires an unsigned-to-armed reservation transition, preventing
  concurrent workers or imported backups from dispatching twice.
- Recovery tolerates delayed hash visibility, preserves known backup hashes,
  and discovers canonical replacement hashes for identical prepared calldata.
  Both clients must bind the transaction and receipt to the exact saved exit.
- Final receipt checks cover every exit event field, finalized selected
  nullifiers and stable blocks. Expired unused quotes release notes even when
  a dropped transaction hash was previously saved.
- Public full-pool event scans process at most 128 pages of 1024 blocks per
  recovery call, retain a canonical cursor and never send private selective
  event filters. Saved-journal listing bounds RPC concurrency.
- Failed initialization disposes resources; aborted or disposed wallet actions
  cannot reach dispatch. Backup key derivation and plaintext buffers are cleared.
- The original fixed enhanced-fee adapter reader additionally verifies both
  pool and adapter genesis bindings. Its public selection remains restricted to
  compiled, opaque, withdrawal-only KZG contexts.
- The wallet connector cleans up failed handshakes, closed popups, transfer
  errors and message errors. The initial handshake is bounded to 30 seconds;
  a bound wallet's user review has no automatic timeout.

Public method signatures and backup schema are unchanged. New journal fields
(`settled`, `scanBlock`, `scanAnchor`) are internal and optional. SOW 3 can retain
its current backup/list/recover controls. Repeated `recover` calls continue a
bounded public scan; pending work never authorizes a fresh submission.

## Verification

`npm --prefix packages/vanta-sdk test` runs the JS-only build, the complete
current-family suite and consumer TypeScript checks. The completed suite has
167 passing tests, including 21 new exit-host lifecycle cases, four fee-reader
cases and three connector cases. Lifecycle fixtures use real AEAD and CAS
storage with synthetic RPC and proof boundaries; they are not real proofs.

Package validation uses `scripts/check-family-package.mjs`, the complete
export/type/import closure and an actual `npm pack --ignore-scripts` archive.
The package manifest test verifies exact archive membership and rejects prior
custody/policy engines. Historical catalog entries contain signed public
metadata and original artifact pins; no old SDK executable is loaded.

An opt-in read-only live check also passed at finalized Chikyu block 9514824
at 2026-11-16 04:24:33 UTC. It validated the original signed release and queried
both original pools using an ethers JsonRpcProvider and a separate
BrowserProvider/EIP-1193 fetch adapter on the existing public RPC:

| Pool | Original enhanced adapter | Rates in approved operation order |
| --- | --- | --- |
| Original native pool | Original signed native adapter | `[15, null, 0, 15, null, null]` |
| Original token pool | Original signed token adapter | `[15, null, 0, 15, null, null]` |

Rates are basis points, and `null` means unavailable. Both adapters matched the
same original policy hash. Exact live deployment and block pins are retained in
the source-only acceptance script and execution evidence, keeping this
unconfigured source package free of deployment defaults.
Reproduce with `node packages/vanta-sdk/test/historical-fee-live.acceptance.mjs
--run`. This script loads no wallet, submits no transaction and generates no
proof. The pinned original deployment must still be the current publication;
a publication change fails the check rather than silently rebinding it.

## Remaining acceptance boundary

A genuine funded old-to-new historical withdrawal has not been exercised.
That acceptance must use the already-completed ceremony outputs, the actual
sealed history and original-generation proving artifacts. The funded bootstrap
cutover guard remains in place. This source draft does not assert production
fund safety, independently deploy the recovery UI, enable mainnet, or qualify
every historical relayer. The latest wallet UI changes belong to SOW 3 and
still require its browser acceptance.

The recovery phrase restores note identity. Pending withdrawal and enhanced
claim capabilities also require their corresponding encrypted journal backups;
this work does not promise phrase-only recovery of all claims.

No contracts, sealer implementation, circuit/R1CS files, native/WASM artifacts,
ceremony inputs or cloud resources were changed by this completion delta.
No ceremony construction, service restart, deployment, paid-plan increase or
additional billable resource was performed.

## Private-send integration qualification (November 16)

The source now includes a wallet-local private-send host and versioned public
receiving addresses. It uses the existing normal 8/32-input Gate0, lookup/link
and 40-signal KZG partner-fee relations. Eight inputs are selected whenever
they suffice. Quote requests contain public bindings, without note openings.
Submission arms shared note reservations before dispatch; unknown outcomes
remain reserved and canonical nonce events recover replacement hashes.

The current suite passes 173 tests and TypeScript checks. The existing pinned
normal-8 WASM accepted a genuine native joinsplit witness, matched all five
output commitments, rejected unrelated change randomness, and delivered an
encrypted note recoverable by another wallet. This was a native preview and
note-recovery check, not a funded on-chain private-send proof acceptance.
Funded private-send, private swap and private bridge acceptance remain open.
