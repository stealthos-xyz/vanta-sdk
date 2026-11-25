# Partner integration guide

**SDK 0.4.65 · DogeOS Chikyu testnet (6281971) · 24 November 2026**

This is the repository-level integration guide for the current signed release. The [audit report and findings](audit/README.md) are available separately. Partners integrate with the registered StealthOS service and existing signed pools; they do not need to run a ceremony, deploy their own pools, expose service signing keys, or host private wallet credentials.

For a shareable DogeOS onboarding guide and reference app, see [DogeOS implementation guide](DOGEOS_PARTNER_GUIDE.md) and [quickstart](QUICKSTART.md). Detailed operation examples and lifecycle states are in [TRANSACTIONS.md](TRANSACTIONS.md).

## 1. Register the partner application

1. Open the [partner portal](https://partners.stealthos.xyz). Register the partner handle, supported assets, applicable partner fees and each exact HTTPS app origin.
2. Download the application's public configuration for the current signed release. Confirm `sdkVersion` is `0.4.65`, `networkId` is `eip155:6281971` and the generation matches the [signed publication](../releases/0.4.65/publication.json).
3. Serve that configuration, for example at `/stealthos-partner-config.json`, on the registered application origin. Do not substitute another partner's handle, configuration or generation.
4. Supply primary and verification HTTPS RPC URLs with distinct origins for independent endpoint verification. Legacy single-endpoint configuration does not provide independent verification. Do not include credentials in publicly served RPC URLs.
5. Enable only assets and routes present in the signed configuration. A newly enabled asset requires its partner registration transaction; hiding an asset does not remove historical recovery rights.

## 2. Install and verify

```sh
npm install --save-exact https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/artifacts/objects/097e12aad803a824d4aab872cfd612b53195f510f91a2e799a00d29bb5e00940.tgz
npm install --save-dev esbuild
```

Commit the lockfile. The identical signed archive is [available in the repository](../releases/0.4.65/stealthos-vanta-sdk-0.4.65.tgz); its SHA-256 is `097e12aad803a824d4aab872cfd612b53195f510f91a2e799a00d29bb5e00940` (1,659,865 bytes). For source verification, clone the SDK repository, use Node 24.14.1/npm 11.11.0, run `npm ci` and `npm run verify:release -- 0.4.65`. This checks the publication signature, archive digest and reproducible package.

Use ESM imports. No CommonJS wrapper or private entry point is required.

## 3. Build and serve the workers

Copy [build-workers.mjs](../examples/build-workers.mjs) into your app and run `node build-workers.mjs`. The example bundles `@stealthos/vanta-sdk/worker` into `public/stealthos/app-wallet-worker.mjs` and copies `@stealthos/vanta-sdk/proof-worker` next to it under its original filename, `unified-bound4-bootstrap-worker.js`. Serve the files as JavaScript from the registered app origin. Permit module workers, WASM and configured HTTPS endpoints in your CSP. Avoid widening worker or network permissions beyond the required resources.

## 4. Open the wallet

```js
import {openStealthOSPartnerApp} from '@stealthos/vanta-sdk';

export async function connectVanta(provider, onLocked) {
  const response = await fetch('/stealthos-partner-config.json');
  if (!response.ok) throw new Error('Partner configuration unavailable');
  const configuration = await response.json();
  const wallet = await openStealthOSPartnerApp({
    configuration,
    provider,
    workerUrl: '/stealthos/app-wallet-worker.mjs',
    onLocked,
  });
  return {wallet, configuration};
}
```

Pass the selected wallet connector's EIP-1193 provider, not a guessed injected provider. The returned client binds the application, network, partner and customer session. It handles the customer's on-demand wallet session authentication. A service JWT or HMAC secret must never be passed to your client.

## 5. Wallet, balance and receiving lifecycle

| Task | Public client methods |
| --- | --- |
| Create | `createPrivateWallet({password, confirmRecoveryPhrase})` |
| Restore | `restoreWallet({password, phrase})` |
| Existing local wallet | `restoreWallet({password})`, or `unlockRememberedWallet()` when allowed by the returned wallet settings |
| Password preferences | `getPasswordSettings()`, `setPasswordRequirement(requirePassword)` |
| Asset selection | `selectAsset(asset)` |
| Immediate balance display | `getCachedBalance()` (display only) |
| Verified notes and history | `recoverNotes()` |
| Private receiving address | `receivingAddress()`; use exported address encoding/decoding helpers |
| Handle lookup and claim | `handleAvailable`, `claimHandle`, `currentHandle`, `findHandle`, `resolveHandle` |
| Lock or tear down | `lockWallet()`, `dispose()` |

The create callback displays the phrase locally and returns a boolean only after the user confirms its safe storage. Never log, upload or include passwords, phrases, witnesses or private memo plaintext in analytics, support tickets, URLs or server-side application state. Keep wallet controls local. Use the exact asset decimals and integer atomic-unit strings for all values; do not convert them to floating point. Treat cached balances as display projections, not authorization to spend, and allow canonical recovery to finish. Reopen or lock the client when the connected account/network changes.

The SDK warms public proving artifacts without blocking the wallet home screen and verifies their hashes. Retain the normal approval and expiry checks even when a proof or balance is warm.

## 6. Transaction review and execution

Every funded action must follow the reviewed quote, explicit customer approval, proof/transaction preparation, submission and canonical reconciliation lifecycle. Show exact recipient, asset, amount, fees, total debit, and applicable gas reserve, route minimum output, delivery fee and validity. Do not treat a fee preview as a signature or submit changed parameters behind a user's approval. If a quote expires or its bound policy changes, obtain and present a new quote.

For direct deposits:

```js
export async function reviewDeposit(wallet, configuration, amountAtomic) {
  return wallet.quoteDeposit({
    amountAtomic,
    partnerHandle: configuration.partnerHandle,
  });
}

// Invoke only after your UI has displayed the exact quote and the user approves.
// Preparation already handles any required token allowance approval.
// Optionally stage approveDepositAsset with the same reviewed quoteId.
export async function submitReviewedDeposit(wallet, quoteId) {
  const prepared = await wallet.prepareReviewedDeposit({quoteId});
  const submitted = await wallet.executeDeposit({preparedId: prepared.preparedId});
  return wallet.reconcileDeposit({
    preparedId: submitted.preparedId,
    transactionHash: submitted.transactionHash,
  });
}
```

An ERC20 approval is not a deposit. Reconcile the result and pending history rather than immediately retrying if the wallet rejects a request, the transport disconnects or submission is ambiguous.

| Operation | Fee review | Preparation | Execution and reconciliation |
| --- | --- | --- | --- |
| Direct deposit | `quoteDeposit({amountAtomic, partnerHandle})` | `prepareReviewedDeposit({quoteId})` | `executeDeposit({preparedId})`, `reconcileDeposit({preparedId, transactionHash?})` |
| Private send | `quotePrivateSend({recipient, amountAtomic, partnerHandle})` | `prepareReviewedPrivateSend({quoteId, memo?})` | `executePrivateSend({preparedId})`, `reconcilePrivateSend({preparedId})` |
| Public withdrawal | `quoteWithdrawal({amountAtomic, destination, enhanced:false, partnerHandle})` | `prepareReviewedWithdrawal({quoteId})` | `authorizeWithdrawal({intentId, enhanced:false})`, `monitorWithdrawal({transactionId, enhanced:false})` |
| Enhanced withdrawal | Same withdrawal quote with `enhanced:true` | `prepareReviewedWithdrawal({quoteId})` | `authorizeWithdrawal({intentId, enhanced:true})`, `monitorWithdrawal({transactionId, enhanced:true})` |
| Public batch | `quotePublicBatch({payments, partnerHandle})` | `prepareReviewedPublicBatch({quoteId})` | `authorizePublicBatch({intentId})`, `monitorPublicBatch({transactionId})` |
| Swap / bridge | `quoteRoute({operation, amountAtomic, slippageBps, receiver})`, then `quoteRouteFees` with the bound venue quote fields | `prepareReviewedRoute({operation, quoteId})` | `executeRoute({operation, preparedId})`, `reconcileRoute({operation, preparedId})` |

For route reviews use operation 4 for swap and 5 for bridge; pass the reviewed receiver, amount, minimum output, maximum delivery fee, and partner handle to `quoteRouteFees`. Use supported assets and receivers only. For public batches, `payments` is an array of `{recipient, amountAtomic}`. The registered partner wrapper binds the configured partner handle; passing it explicitly is compatible with the published method types. Refer to the [wallet client method types](../packages/vanta-sdk/browser/app-wallet.d.mts) and [public exports and quote types](../packages/vanta-sdk/api/wallet.d.mts) for exact return values.

For public payment links, use the separate root export `openStealthOSPublicPayment({configuration, provider, recipient, workerUrl})` and its `quotePayment`, `approvePaymentAsset`, `prepareReviewedPayment`, `executePayment`, `reconcilePayment` and `listPendingPayments` methods. Dispose of the client when done.

### Fees and routes

Read the registered on-chain fee policy and use the values returned by the SDK's review. Do not hard-code fee rates, rounding, token decimals or gas reserves. A direct deposit is paid by the connected wallet and uses the existing native wallet admission/clearance policy. Valid clearance can be reused; expired clearance or a changed funding address can require renewal. Partners do not sign per-deposit quotes or perform their own wallet screening for SDK admission.

On enhanced withdrawals, authorization and individual installment completion are distinct events. On CCIP routes, source submission and verified destination delivery are distinct events. Private-output swap settlement can also have a pending output. Do not mark these transactions finalized merely because the source transaction was included.

## 7. Recovery, failure handling and upgrades

- Use `listPendingDeposits()`, `listDepositHistory()`, `listPrivateSends()`, `listWithdrawals()` and `listRoutes(operation)` to recover and display journal state. Preserve the original identifiers and reconcile from canonical receipts before any replacement.
- Display uncertain, failed, cancelled, expired and finalized states accurately. For pending operations, re-read the status and use the applicable reconciliation method. Never report a pending operation as lost or as safely replaceable until its canonical state permits that conclusion.
- `exportRecoveryBackup()` and `importRecoveryBackup(file)` support the trusted encrypted recovery UI. Keep the customer's private storage and backup material under their control. The `/recovery` entry point provides historical-generation wallet and local vault APIs; preserve older generation resources for exits.
- Keep package, worker and proof assets pinned to the matching publication. Deploy the new public configuration and rebuilt workers together. Do not silently fall back to older artifact hashes, route identities or fee rules.
- If origin, signed generation, provider or release identity changes unexpectedly, stop the funded operation, surface the error and obtain matching trusted configuration.

## 8. Partner acceptance checklist

Before opening the integration to users:

- [ ] Registered HTTPS origin and current public configuration match.
- [ ] Signed archive and both worker assets are pinned and available.
- [ ] Correct network, generation, supported assets and distinct RPC origins are configured.
- [ ] Create/restore/lock, receiving identity and exact atomic-unit display work on the intended browsers.
- [ ] Quote, explicit approval, preparation, submission and reconciliation work for each enabled testnet operation.
- [ ] Wallet rejection, expiry, interrupted submission and pending history are handled without duplicate spending.
- [ ] Encrypted recovery backup, historical-generation access and supported exits are available in the wallet UI.
- [ ] The [audit findings](audit/README.md) and [scope of assurance](audit/Vanta_DOGE_Audit_Report_2026-11-24.pdf) have been reviewed. Testnet integration is not mainnet custody authorization.

## 9. Public API map

| Entry point | Reference |
| --- | --- |
| Root wallet and payment APIs | [wallet.d.mts](../packages/vanta-sdk/api/wallet.d.mts) |
| Browser wallet client | [app-wallet.d.mts](../packages/vanta-sdk/browser/app-wallet.d.mts) |
| Network and fee metadata | [network.d.mts](../packages/vanta-sdk/api/network.d.mts) |
| Partner enrollment | [setup.d.mts](../packages/vanta-sdk/api/setup.d.mts) |
| Local recovery and generations | [recovery.d.mts](../packages/vanta-sdk/api/recovery.d.mts) |
| Worker build | [build-workers.mjs](../examples/build-workers.mjs) |

For onboarding, use the [partner portal](https://partners.stealthos.xyz). Include only sanitized public error details, network, SDK version and relevant public transaction receipt identifiers in support requests. Do not share secrets, private wallet journals or witness data.
