# Enhanced private payout helpers

Import `@stealthos/vanta-sdk/enhanced-payouts` from an ESM trusted wallet or host.
These helpers select private payout terms and project verified progress. They
do not authorize spending, generate proofs, submit claims or qualify a release.

## Private terms

`createEnhancedPayoutSchedule` takes the exact net amount in atomic units. It
uses browser/Node Web Crypto rejection sampling to split that amount into three
positive portions, with each portion at least `dustAtomic` (default one). Equal
portions are valid. The three amounts sum to the requested net exactly; mandatory
fees are separate private notes in the funding proof and are not subtracted a
second time by this helper.

The default authorization epoch is `floor(nowSeconds / 60)`. Each release lies
between authorization plus five epochs and authorization plus 360 epochs, by
default. The host may supply a different positive delay or configurable window.
Pass the independently verified contract's `maximumWindowEpochs` as policy;
360 is a default, not a protocol maximum. Three distinct ordered release epochs
produce disjoint private windows. The minimum net is three times the dust floor.

The returned schedule is private wallet state. It contains the original total,
amounts and times. Do not expose it in logs, public events, signed fee quotes or
claim transaction metadata. The future trusted prover derives three distinct
claim secrets/nullifiers and creates delegated fixed-payment capabilities. This
helper accepts no wallet seed, spending key or entropy override. Entropy failure
throws; there is no predictable-randomness fallback.

## Verified progress

`projectVerifiedEnhancedPayoutStatus` accepts the pinned network, generation,
pool and asset context; three expected fixed claims; and observations verified
by a trusted chain reader. It rejects changed recipients, amounts, nullifiers
and domains. Canonical block hashes and finalized block height determine whether
a payment counts. A reorganization or loss of finality can reduce the displayed
completion count.

The result contains only `0/3` through `3/3`, settlement/recovery flags, each
claim's ordinal/state and transaction hash. It excludes totals, amounts,
nullifiers, secrets and schedule details. This projection cannot authenticate
RPC data itself. A host must verify canonical contract logs against its pinned
deployment before passing a receipt; caller-supplied JSON is not payment proof.

The delayed claim contract statement contains shared roots, one unlinkable
nullifier, fixed recipient, individual amount, execution epoch and recovery bit.
Chain, pool, asset, full genesis and generation are reconstructed from immutable
contract context. A relayer gets a fixed-claim capability, not wallet spending
authority. Current-epoch proofs need automatic refresh and durable outbox
reconciliation before execution can be enabled.

The existing `/payouts` MCP-shaped tools remain planning-only and do not grant
spending authority. A qualified signer/prover host must reuse its current agent
permissions before authorization, monitoring or recovery becomes executable.
This work does not enable the superseded three-public-commitment execution path,
accept injected executors as qualification, or add a separate x402 approval.

## Checks

Run `node --test test/enhanced-payouts.test.mjs` and `npm run test:types` from this
package. These tests establish integer conservation, private scheduling,
entropy handling, receipt binding and reorg-aware progress. Genuine proofs,
Solidity execution, mobile proving and ceremony qualification are separate gates.
