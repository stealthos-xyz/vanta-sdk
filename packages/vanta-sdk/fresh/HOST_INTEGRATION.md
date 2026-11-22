# Local host integration

Current KZG SDK. Local bridge protocol: `stealthos-local-host-v1`.

The package is ESM and headless. It has no React, Wagmi or MyDoge dependency.
MyDoge native Privacy screens and the standalone StealthOS frontend can use the
same privacy engine through separate host adapters. MyDoge's application
framework and native host bindings must be confirmed by its engineers.

## Public modules

| Package export | Responsibility |
| --- | --- |
| `/host-wallet` | Selected EIP-1193 or native account, exact message signing, approved public transactions, context invalidation |
| `/host-storage` | Account/address/network/generation scope, durable atomic native storage, dedicated privacy phrase vault, local create/unlock/backup/restore |
| `/host-worker` | Local Worker lifecycle, bounded public messages, progress, cancellation and restart reconciliation |
| `/host-worker-endpoint` | Trusted worker command endpoint with explicit implemented capabilities |
| `/host-family-runtime` | Production runtime factory that verifies the compiled family deployment before initializing secrets, prover or operation handlers |
| `/dogeos-network` | Chikyu metadata, one-asset native DOGE accounting, execution plus Data/Finality fee budgeting |
| `/family-network` | Compiled signed activation and finalized deployment graph verification |

The storage backend must implement an encrypted local database transaction for
compare-and-swap. Its completion acknowledges a durable commit. A JavaScript
Map cannot provide native durability. Store notes, pending operations and
reconciliation evidence in the same account-scoped transaction domain. Never
replace a durable uncertain operation with an automatic retry.

The local wallet controller preserves the current SDK's dedicated twelve-word
privacy identity. Native authentication unlocks that secret; it does not derive
it. The EVM seed is neither exported nor used. Changing login messages cannot
change privacy identity. Recovery signatures do not need repeatability for this
phrase-based flow. Secret UI callbacks and vault access are trusted device-only
interfaces and are never public bridge commands.

## Trusted runtime composition

Native UI sends bounded intent commands to an app-bundled, trusted local worker
inside the agreed prover host. Production composition uses
`createVantaFamilyHostRuntimeFactory({provider, initializeRuntime})` as the
`createRuntime` supplied to `installVantaHostWorkerEndpoint`.

The factory first validates the requested context, checks cancellation and calls
the non-injectable `verifyCompiledFamilyEvmRuntime`. That existing verifier checks
the compiled signed activation, reviewed network-family policy, genesis,
finalized contract graph and bootstrap relayer-configuration binding. The
verified network and generation must match the requested host context. Only
then may `initializeRuntime` open the local vault or initialize the prover. It
receives the checked context and verification summary, not permission to select
another generation. An RPC response cannot choose a release, and the factory
accepts no replacement verifier or bypass flag.

`initializeRuntime` remains trusted application composition. It must bind the
existing local engine to matching compiled artifact inventories, scoped storage,
active-wallet approval and relayer transport. Existing proof-resource loaders
still verify exact bytes/hashes; the factory does not itself download artifacts
or implement funded transactions. Read RPCs and relayer transport remain separate
from wallet approval. Keep secrets and witnesses out of requests and telemetry.

The initializer returns only actually implemented `capabilities`, an `execute`
handler and `dispose`. The factory supplies the checked `verifiedContext` and
validates the capability list. Network/generation verification does not prove
account ownership: the native wallet and secure-store adapters still bind the
requested `accountId` to the active account/revision. If cancellation or validation fails after the
initializer returns, it disposes that runtime. The initializer must also clean
up allocations if it throws before returning. Factories, vault callbacks and
runtime objects are trusted internal APIs; only the endpoint's validated
commands, safe results and sanitized errors belong on the UI bridge.

Use the existing fresh WASM proof engine off the UI thread. Background, lock,
account/chain change, crash, timeout and cancellation terminate the worker.
Restart creates a new worker, unlocks the correct scope, checks activation again,
and reconciles the durable operation journal before any new write. Termination
does not cancel a transaction already submitted to a network or relayer.

Every runtime declares only implemented operations. Deposit, private send,
withdrawal, swap and bridge commands are rejected unless supported by that
runtime and reconciliation has succeeded. A source transaction hash never means
CCIP destination delivery. Delivery requires separately verified destination
transaction evidence and the correct message ID.

The transport command definitions and verification factory do not complete the
six native flows: deposit, private balance/recovery, private send, withdrawal,
MuchFi swap and CCIP bridge. Each still needs its real generation-compatible SDK
handler, route configuration and acceptance evidence. Never advertise a command
because its name exists in the protocol; the runtime must implement its complete
operation and durable reconciliation behavior first.

## Release status and partner acceptance

This source package is deliberately unconfigured. Adding transport adapters does
not activate a DogeOS custody deployment. The current compiled funded client is
Base-specific; it cannot be relabeled as Chikyu. A DogeOS build requires the
reviewed family profile, genuine matching proof resources, a signed network
activation, finalized contract bindings and corresponding funded SDK routes.
Unconfigured artifacts continue to reject use.

The factory's focused tests establish that an unconfigured family package,
aborted startup or malformed context cannot invoke native secret/prover
initialization. They do not establish successful activation or genuine proof
execution for a released DogeOS generation.

The repository contains the native host specification, operation gap matrix,
local Worker harness, official DogeOS web connector reference and server-only
partner authorization example. The web shell uses DogeOS SDK 4.0.7. Its React
and Wagmi dependencies are installed only in that example.

Native acceptance requires partner iOS and Android builds using MyDoge's own
screens, active wallet and secure storage. Record genuine local proof results,
Chikyu transactions, restart recovery, second-device restoration, MuchFi
settlement and CCIP destination delivery. Also exercise the standalone frontend
with a standard EIP-1193 wallet. Local transport tests do not satisfy these gates.
