# Enhanced withdrawal host and agent tools

The ESM `@stealthos/vanta-sdk/enhanced-host` entry provides the framework-neutral
host used by a wallet or delegated agent. It preserves the existing context,
review, progress and `prepare` / `authorize` / `monitor` / `list` / `recover`
interface. The package root exports the same constructors and types.

The packaged execution gate returns `NOT_READY`. Frozen production artifacts,
release approval and complete deployment qualification are still required.
There is no caller-controlled `enabled`, readiness, verifier, pool-selection or
signer override. Tests exercise the internal state machine separately; this is
not production activation.

## Trusted application integration

Application bootstrap supplies four values to `createEnhancedWithdrawalHost`:

- `context`: the pinned account network, generation, pool and asset identity.
- `store`: the existing `createVantaHostAtomicStore` adapter over account-scoped,
  encrypted, local storage with durable compare-and-swap commits.
- `runtime`: the local qualified wallet/prover/relayer composition.
- `getSession`: the current authenticated subject, delegation, expiry and limits.

No secret or runtime function is accepted as a model tool argument. The host's
public context and all returned reviews/statuses are immutable. The wallet and
agent use the same public host methods; no browser global is used to choose a
privileged account or activate execution.

The runtime has five methods. `getPolicy` reads the verified execution policy.
`prepare` durably persists the private proof inputs and fixed claim capabilities
under an opaque prepared handle, returning only a review. `authorize` is the
sole method permitted to request the user's off-chain signature. `monitor`
reconciles canonical funding and claim receipts. `recover` executes existing
fixed obligations, using current global roots and the same claim nullifiers,
without requesting another user signature.

The runtime must resolve the context against its exact compiled release,
including full chain/genesis/generation and verifier/key bindings. It must
verify the quoted fees against the policy, preserve private fee/gas outputs,
enforce the 20% reserve and spike policy, and bind the same net amount and
recipient to funding, reservation and claims. The host validates review totals,
asset symbol and expiry; those checks do not replace genuine funding proofs.

Prepared handles and consumed shielded notes must be durably reserved by exact
intent before signing. Note reservation spans every wallet operation that can
consume those notes, including other pool/generation adapters. The runtime must
recheck live authority immediately before its actual signature, including after
an asynchronous wallet prompt. It must never independently retry a possibly
completed authorization after a lost response. The host's intent binding and
prepared handle must select the same immutable private state on restart.

## Intent durability and authority

`prepare` creates a CSPRNG schedule with three positive payouts that sum to the
exact requested net amount. It obtains protocol/partner fees and gas reserve
from the runtime, checks their exact sum against total debit, and persists the
review, schedule and prepared handle. `review.asset` equals
`context.assetSymbol`. Its exclusive expiry cannot exceed the verified
authorization admission window or the current session's expiry.

Before calling the runtime's authorization method, the host commits an
`authorizing` record using durable compare-and-swap. Independent controllers
cannot authorize the same intent twice. Any authorizing or ambiguous intent
also blocks a fresh authorization in that account's pool/asset journal until
canonical success or definitive failure is established. Preparing another
quote does not remove that barrier.

The session may restrict destinations, total debit per intent, cumulative debit
per delegation and method permissions. Cumulative debit includes unresolved and
completed spending; only definitive authorization failure releases it. Limits
are checked inside the atomic update and again before the wallet callback can
run if authority changed during storage I/O. Permission changes and a closed or
expired session cannot cause an old request to acquire a new signature.

An unknown signing result stays locked. `list` exposes it after a restart even
while the runtime is unavailable, reporting pending recovery rather than cached
settlement. `monitor` and `recover` do not call authorization. Current canonical
observations can roll back displayed progress after a reorg, and an older
concurrent observation cannot overwrite a newer stored observation.

The runtime's `authorizationFailed` status means definitive failure with no
remaining broadcast or reserved spend capable of succeeding. A transient RPC
failure, timeout or missing receipt does not satisfy this condition. It must not
release a note reservation or report failure merely because a transaction is
temporarily absent from the mempool.

An included/finalized permissionless claim may have a null relayer-owned
transaction hash. The independently verified winning receipt establishes
payment, while the queue retains its own attempt hash for gas reconciliation.
These records must not be substituted for one another.

## MCP integration

`createEnhancedWithdrawalAgentTools` accepts a host created by this module and
the bootstrap-selected subset of `prepare`, `authorize`, `monitor` and
`recover`. It exposes transport-neutral MCP tool definitions and an `invoke`
method. `enhanced.list` shares the `monitor` permission. Every invocation also
checks the host's current session, so registering a tool grants no additional
wallet authority.

Tool schemas reject extra fields. Agents cannot provide private keys, witnesses,
proof endpoints, a replacement pool, fee overrides, arbitrary transactions or a
replacement payee at authorization. Errors are fixed codes without raw wallet,
proof, RPC or storage exceptions. Returned identifiers, reviews and statuses are
private to the authenticated client. Do not put them, the schedule, prepared
handles or capability material in public calldata, events, analytics or logs.

## Qualification scope

The tests exercise the actual host CAS adapter with a test backend and adversarial
runtime responses, including concurrent controllers, lost signing responses,
fresh-intent ambiguity, revocation, budget limits, restart, RPC failure and
permissionless completion. The backend fixture does not establish native
encrypted-storage durability. Real proof/contract/queue qualification is tracked
separately; host tests do not imply a completed production wallet runtime,
physical mobile benchmarks or production release approval.

## Durable unsigned review cancellation (P0 follow-up)

The internal host adds the **`cancel({intentId})`** method and a mandatory
trusted runtime **`cancelPrepared(boundIntent)`** implementation. These are
local wallet authority and note-reservation operations, not public relayer
settlement transactions. A reviewed quote must not be forgotten merely by
clearing the React UI: reserved inputs remain protected until the runtime
confirms that the encrypted note lock was durably released.

Cancellation commits the `cancel_pending` journal phase using the same CAS
mechanism as authorization **before** invoking `cancelPrepared`. Authorization
rejects this phase, and `cancelled` is terminal. The runtime callback must be
idempotent, reject a signed/broadcast spend, and return exactly
`{released:true}` only after the original input reservation is durably
released. A crash between note release and journal finalization is safe to
retry. A failed/ambiguous cleanup keeps the intent `cancel_pending` and
blocks new preparation until the next `prepare` retries cleanup. Expired
never-authorized quotes are likewise fenced and reclaimed on the next
preparation. Only the original authenticated subject may cancel; it is never
allowed to cancel an already-authorizing/tracking spend. No extra wallet
signature is requested for cancellation.

The compiled package entry gate remains `NOT_READY`. Unit tests exercise the
internal host with a simulated local atomic backend, not the unpublished
concrete family runtime or a physical wallet. The final SDK archive must export
this method and include a genuine family-host implementation with the same
contract before the wallet UI can be considered integrated. A missing
`cancelPrepared` implementation must fail closed. Existing setup, proving
keys, contract verifiers, and previous ceremony transcripts are unchanged.
