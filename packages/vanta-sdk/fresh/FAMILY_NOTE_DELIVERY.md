# Internal family note delivery and recovery

These internal ESM modules serve current-family note delivery and canonical
recovery. The compiled signed network domain is required; they are not direct
package exports and cannot activate a release. Every domain, opening and result retains
`safeForFunds: false`. A local host supplies the pinned release and native
engine; neither is an agent tool argument.

## Ownership and encryption

`createFamilyNoteDelivery({domain, engine})` accepts the canonical DogeOS family,
chain 6281971, chain genesis, setup and generation IDs, custody pool and asset,
pool code hash, and measured native glue/WASM hashes. Amounts are canonical
decimal strings in the circuit's unsigned 120-bit range. Zero amounts are
explicitly nonspendable and never produce a nullifier.

The four native ownership operations use the existing BabyJubjub spending key,
native Poseidon master key, note commitment and token-bound nullifier relation.
`walletRecipient(wallet)` first checks that the established wallet's master key
matches the exact native engine. `verifyRecipientNote` validates an opening
against a recipient's public master key; `verifyOwnedNote` additionally proves
local key ownership. An opening alone establishes neither on-chain funding nor
membership.

`encrypt({recipient, note})` verifies the opening before using an ephemeral
X25519 key, HKDF-SHA256 and AES-256-GCM. All envelopes contain exactly 829 bytes,
including a padded 768-byte plaintext record and the authentication tag. This
keeps amount length and zero-fee classification out of the ciphertext length.
Authenticated data binds the family, chain, genesis, setup, generation, pool,
asset, token hash, note commitment, recipient master key and viewing key.

Only a local wallet supplies owner secrets. Encryption to a collector requires
its authenticated public receiving route, not its spending or viewing private
key. Secret byte copies owned by the module are wiped where practical; this is
not a claim that immutable JavaScript strings or every runtime copy can be
erased. Callers must keep plaintext openings, wallet backups and recovery
inventories in authenticated encrypted storage and out of logs or agent output.

`decrypt({wallet, envelope, commitment})` returns a locally verified opening or
`null` for an envelope that does not authenticate to this wallet and domain.
Malformed authenticated plaintext is rejected. Encryption authenticates bytes
to a public receiving key; it does not prove that the sender is honest.

## Canonical recovery

`recoverFamilyCanonicalNotes({provider, verificationProvider?, delivery,
wallet, deploymentBlock})` reads the complete global custody event stream. It
never sends private note commitments, nullifiers, openings or wallet keys as
RPC filters. It requires an actual finalized anchor, checks genesis, custody
code and immutable release bindings, and validates every row/envelope pair,
canonical block, per-epoch row count and consumed nullifier. Historical closed
epochs remain visible. An optional independent provider must agree on the
anchored state and complete event stream. There is no fallback to `latest`.

The returned inventory describes one finalized block. It is not a spend grant
or a claim that a public RPC is trustless. A production host still needs a
qualified finality source and current note reservation/reconciliation before
authorizing spending. A new contract generation is scanned using its own pinned
domain; this helper does not silently discover or trust another deployment.

Invalid authenticated deliveries are quarantined by public row location so a
malicious sender cannot erase valid recovered notes. Repeated positive notes
are deduplicated by native nullifier and quarantined rather than counted twice.
Repeated valid zero notes remain explicitly nonspendable. Structural canonical
state mismatches reject the inventory entirely.

`verifiedSpendableAtomic` sums only individually verified, unique, unspent
notes. If any row is quarantined, `complete` is false and
`balanceAtomicAtAnchor` is null. The caller must not present a complete or empty
balance from that partial result. `verifiedEmpty` specifically means that the
verified public pool history contained no encrypted rows.

## Qualification and integration boundaries

`scripts/p0-enhanced-readiness/qualify-family-note-delivery.mjs` loads the exact
recorded family build and runs actual Node WebCrypto/WASM ownership, encryption,
large-amount, domain and malformed-delivery checks. Its recovery parser tests
use synthetic RPC fixtures and label that scope explicitly. This is separate
from the genuine funded encrypted-delivery replay, real browser proving and
physical mobile qualification. Build hashes and measured source hashes are
preserved with each report.

Before production integration, the host must authenticate the collector route
against the pinned registrar and fee registry, including the master key,
viewing key, receiver salt, receiver commitment, proof commitment and role.
Existing Base receiving-route and onboarding functions remain Base-bound.
The disposable funded replay may intentionally assign one actual wallet to all
three collector roles; that evidence does not qualify separate production
collector registration, rotation or recovery services.

The authorization builder must bind the same verified openings and encrypted
envelopes to the genuine funded proof and calldata. Recovery then confirms
those exact outputs through canonical custody events. Automatic fee-note
delivery, ownership recovery and the queue's funding callbacks must use that
binding before a production host is enabled. Production packaging, release
pins, signer integration and the ceremony approval gate remain unchanged.
