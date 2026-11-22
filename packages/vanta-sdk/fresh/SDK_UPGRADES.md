# SDK updates and historical KZG withdrawals

Partners pin the exact SDK archive and lockfile integrity. Adopt a new version
explicitly through the application's normal review and release process. An
update proposal is data: `inspectVantaFamilySdkUpdate` checks its signature,
network/deployment bindings and a separately approved archive digest. It never
fetches or executes update code. A valid signature identifies the publisher;
it cannot establish that the publisher's software is harmless.

An SDK-only update retains the same pools and balances. A contract deployment
creates another generation; it does not migrate users' notes. Only the active
generation accepts SDK deposits. The latest SDK retains approved older KZG
generations for withdrawals using their original circuit keys and artifacts.
RPC state cannot add a generation, choose a replacement pool or substitute a
prover. Identifiers resolve only through the compiled catalog and opaque
selection capabilities. Signing one generation never authorizes another.

`createVantaFamilyGenerationWallet` opens the selected generation's recovery
host through `openWithdrawal`. That path builds the existing 8- or 32-input
no-append proof locally, verifies and simulates the exact transaction, obtains
user approval and lets the user's ordinary wallet pay network gas. It consumes
the selected notes in full at their original immutable exit fees. It creates
no change note, needs no relayer signature and remains independent of the
former registry's active-pool selection. Amount and recipient are reviewed
before submission. Original on-chain verifiers remain immutable.

Privacy identity storage is account scoped and survives generation changes.
Transaction journals and note reservations retain their exact network,
generation and pool scope. Ordinary withdrawals and recovery exits share a
durable compare-and-swap note reservation. Ambiguous submissions are reconciled
against their original calldata; they are never automatically resubmitted.
Keep the phrase/encrypted wallet backup and encrypted pending-withdrawal backup.
The latter includes the exact transaction journal, can be decrypted by the same
private wallet on another device, and cannot be rebound to another generation.
An imported prepared transaction is treated as potentially submitted until
canonical reconciliation, because the backup may predate a broadcast.
This also applies when the backup matches a prepared transaction already on
the device. Import reserves all affected notes together before adopting the
journal; a conflicting reservation leaves the import uncommitted. If storage
fails after reservation, preserve and retry the same encrypted backup. Those
conservative reservations must not be cleared to make another spend possible.
Cancellation fences the journal before releasing an unsigned reservation.
Wallet dispatch requires both the journal's submitting transition and an
unsigned reservation. Imported armed work cannot dispatch again.

Known wallet transaction hashes remain visible while RPC propagation is
incomplete. Recovery checks exact calldata under either the original hash or
a canonical replacement hash. Lost-hash searches request public exit topics
for the entire pool, compare both client views, and process at most 128 pages
of 1024 blocks per call. The journal retains a canonical scan cursor; call
`recover` again while the status remains submitting. Receipt completion checks
both clients, exact exit event fields, finalized nullifiers and a stable block.
An expired unused quote can release its notes even if its dropped transaction
has a saved hash. No ambiguous withdrawal is automatically rebroadcast.

Browser partners should use the public `/wallet-core` connector for the
separately hosted recovery wallet. The connector has no password, phrase,
proving key or local-wallet API. The wallet window owns unlock, local proving,
recipient/payout review, encrypted backup and transaction approval. Its
cross-origin channel validates origin, source, a fresh session nonce, request
identifiers and a narrow command list. It returns public identity, balance and
transaction status; there is no export-words or app-controlled approve command.
Low-level `/wallet`, `/host-storage` and prover factories belong inside the
trusted wallet/native host, not an untrusted application integration.
The public connector bounds initial handshake waiting to 30 seconds and rejects
outstanding requests when the window closes or its channel fails. Once bound,
user review has no automatic timeout.

The wallet core is released separately from partner application updates. Its
versioned client and source/build artifacts must be pinned and retained, with
manual deployment from the dedicated wallet branch. Do not auto-upgrade its
code from a relayer response or mutable SDK URL. An application SDK update
must not redeploy this wallet origin. Users enter recovery material only in
the independently hosted wallet window. Browser origin isolation protects
against application scripts; compromise of that trusted wallet origin, the
browser/device, or a user approving a fraudulent recipient remains outside
that boundary. This is not a claim that arbitrary signed JavaScript is safe.

The independently hosted recovery UI and connector cover balance recovery,
full-note withdrawals and saved withdrawal recovery. Existing normal-operation
host APIs remain separate. This does not add swap/bridge execution adapters or
claim that every historical relayer has been upgraded. The bootstrap cutover
still rejects funded old pools pending genuine funded historical-withdrawal
acceptance; no reviewer signoff is used as a substitute for a working exit.

Chikyu and mainnet are separate networks and deployments. The catalog can retain
entries by network and generation. The first mainnet release must compile the
verified mainnet chain ID, genesis, policy, contracts, RPC and network-bound
runtime/artifact inventory; the Chikyu entries remain available separately.
This build enables only the known Chikyu network. No mainnet identifiers or RPC
defaults are guessed. The ceremony can be reused when its circuit/R1CS/key
relations remain unchanged. These SDK, fee-policy and deployment changes do not
change those circuits or require a new ceremony.

See `SDK_0_3_0_ACCEPTANCE.md` for the source-draft checks and the remaining
funded historical-withdrawal acceptance boundary.
