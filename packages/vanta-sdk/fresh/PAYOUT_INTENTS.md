# Shared payout intents for wallets and agents

**Planning only. No funds-capable execution or settlement is enabled.**

Import `@stealthos/vanta-sdk/payouts` in an ESM browser or Node application.
The same validator serves a wallet UI and a headless agent. It needs no browser
wallet popup, proof witness, recovery phrase, signing key, new destination
allowlist or additional onboarding step.

## API

- `getFreshPayoutCapabilities()` returns immutable planning support and explicit
  `executionReady: false`, `settlementReady: false`, and
  `x402SettlementReady: false` values.
- `prepareFreshPayoutIntent(context, request)` creates a validated local intent.
- `createFreshAgentPayoutTools(context)` exposes transport-neutral MCP-shaped
  `payout.capabilities` and `payout.intent.prepare` tools using that same validator.
- `assertFreshPayoutExecutionReady()` always throws `NOT_READY`. A configuration
  option, injected executor or relayer response cannot turn execution on.

The trusted host selects `context`: `networkId`, `generationId`, `pool` and
`assetAddress`. Derive it from the independently verified family deployment;
the planner only checks canonical encoding, not signatures, codehashes or
network availability. Do not accept these fields from model tool arguments.
Network IDs are canonical `eip155` IDs within the protocol's 53-bit range;
generation IDs retain all 256 bits. Zero asset address means the native asset.

## Request semantics

`scheduled-withdrawal` accepts `requestId`, one `recipient`, `netPayoutAtomic`,
`windowStart` and `windowEnd`. The net payout must fund exactly three positive
claims. The trusted wallet, not the model-facing planner, will later generate
random portions, salts and release times. Windows are unsigned 64-bit Unix
seconds and must leave room for three strictly increasing release times.

`public-batch` accepts `requestId` and an ordered `payees` array with 2-32 rows.
Each row contains `recipient` and `amountAtomic`. Amounts and their exact sum
must fit the existing positive 120-bit payout limit. Duplicate recipients are
rejected consistently with the existing public-batch validator; they are never
silently merged or reordered. Zero destinations and pool self-payments fail.

All amounts and timestamps are canonical decimal strings. Public payout amounts
are **net atomic asset units**, not gross debits, display denominations or
floating-point values. This does not choose a new gross-versus-net basis for
fees: `feesQuoted` remains false until the canonical fee path is integrated.

An intent returns `status: "planned"`, `authorization: "none"`,
`executionReady: false` and `settled: false`. Its request ID is a local planning
identifier, not proof of a durable reservation or replay protection. Keep the
object local. It contains the requested total and must not be serialized as an
on-chain payload, public event or signed fee quote for a hidden-total withdrawal.
Unknown fields, arbitrary calldata, proofs, private salts and signing material
are rejected. Tool errors contain fixed codes without input or host-error text.

## Execution integration gate

Before replacing the execution guard, connect both callers to the same reviewed
runtime: pinned release and deployment verification, authenticated fee quote,
the existing agent authorization/budget mechanism, trusted local proof creation,
one durable spending reservation, canonical submission and receipt verification.
Neither this planner nor its agent wrapper adds spending authority.

Scheduled progress must distinguish authorization from 1-of-3, 2-of-3 and full
3-of-3 payout completion. Persist and reconcile that state across restarts,
reorgs and pool rollover without blind resubmission. Those execution and receipt
paths are not implemented by this planning module.

An unpaid schedule, first-leg receipt or planned batch is not an x402 settlement
receipt. Leave existing x402 helpers unchanged. Future background session-wallet
funding may use these plans, but spendable x402 balance must still be independently
verified before an API payment proceeds.

## Targeted checks

Run `node --test test/fresh-payouts.test.mjs` from this package directory.
`npm run test:types` includes the payout consumer declarations. The tests establish
local validation, SDK/agent parity, strict boundaries and unavailable execution,
not funded end-to-end acceptance.
