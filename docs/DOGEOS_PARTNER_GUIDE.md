# StealthOS Vanta | DogeOS partner implementation guide

**Signed SDK 0.4.65 · DogeOS Chikyu testnet · Chain ID 6281971 · 24 November 2026**

Audience: DogeOS wallet, frontend and platform engineers. This guide defines the supported partner integration boundary and testnet acceptance path. It is not authorization for mainnet custody.

## 1. Integration at a glance

Integrate the existing Vanta privacy wallet into your browser application using its standalone ESM SDK. Users connect their existing EVM wallet, authenticate to the StealthOS service, and create or restore a local private wallet. The SDK handles signed deployment validation, local note recovery, quote preparation, proof generation and transaction reconciliation. The public wallet pays direct deposits; relayed operations follow the reviewed fee and gas policy. Private keys, recovery phrases and witnesses remain in the customer's trusted local wallet environment.

DogeOS owns its application UI, provider selection, registered HTTPS origin, configuration hosting, customer consent and transaction status UX. StealthOS supplies the signed SDK, existing pool/registry/verifier deployment, partner portal, proof resources and authenticated services. Partners do not need to deploy pools, run a ceremony, hold protocol service secrets or implement custom cryptography.

## 2. Onboarding prerequisites

- Register the partner handle, exact HTTPS application origins, supported assets and fees at https://partners.stealthos.xyz. Register a separate HTTPS test origin if needed.
- Download the current public partner configuration. It must match SDK 0.4.65, network `eip155:6281971`, the signed generation, partner handle ID and enabled assets. See [configuration](CONFIGURATION.md).
- Provide the customer's selected EIP-1193 provider and two credential-free HTTPS RPC endpoints backed by independent sources, on distinct origins. The SDK permits a legacy single-endpoint configuration but that is not independent verification.
- Use testnet funds and only registered assets/routes. New assets require their registration transaction. Do not assume an unregistered token or route is available.
- Build and serve the two worker assets on the registered application origin. Keep the tab open during proving and wallet approval.

## 3. Install, build and serve

Install the immutable archive with a pinned dependency:

```sh
npm install --save-exact https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/artifacts/objects/097e12aad803a824d4aab872cfd612b53195f510f91a2e799a00d29bb5e00940.tgz
npm install --save-dev esbuild
```

SHA-256: `097e12aad803a824d4aab872cfd612b53195f510f91a2e799a00d29bb5e00940`; archive size: 1,659,865 bytes. Commit the lockfile. For source verification use Node 24.14.1/npm 11.11.0 in the SDK repository and run `npm ci` then `npm run verify:release -- 0.4.65`.

Copy the [worker builder](../examples/build-workers.mjs) into the application project and run it there. Host `/stealthos/app-wallet-worker.mjs` and `/stealthos/unified-bound4-bootstrap-worker.js` side by side. Serve the portal's downloaded configuration at `/stealthos-partner-config.json`. Use HTTPS, JavaScript MIME types and an appropriate CSP permitting the required module workers, WASM and configured network connections. See [browser deployment](BROWSER_COMPATIBILITY.md).

## 4. Connect and open a private wallet

```js
import {openStealthOSPartnerApp} from '@stealthos/vanta-sdk';

const response = await fetch('/stealthos-partner-config.json', {cache:'no-store'});
if (!response.ok) throw new Error('Partner configuration unavailable');
const configuration = await response.json();
const wallet = await openStealthOSPartnerApp({
  configuration,
  provider: selectedEip1193Provider,
  workerUrl: '/stealthos/app-wallet-worker.mjs',
  onLocked: () => resetPrivateWalletUI(),
});
```

The selected provider must expose the connected account on Chikyu and support the SDK's sign-in and transaction requests. The SDK authenticates the session; do not build a parallel signing service. Branch on `hasBackup` and password settings. Call `createPrivateWallet({password, confirmRecoveryPhrase})` for a new wallet; the async callback must return true only after the user confirms safe offline storage. For recovery call `restoreWallet({password, phrase})`; for local unlock omit the phrase. Use `unlockRememberedWallet()` only when enabled. Do not log or transmit secrets.

Choose the configured asset with `selectAsset(asset)`. Render `getCachedBalance()` as stale/display-only, then reconcile via `recoverNotes()`. Show available, reserved/pending and spendable values accurately; use atomic-unit strings and exact decimals. Encode the result of `receivingAddress()` with the root address helper or resolve a private handle. Lock/dispose on account, chain, page or session changes; discard stale reviews.

## 5. Implement transaction flows

Use the quote-first flow for every funded action: **quote -> exact customer review -> explicit approval -> prepare -> submit/authorize -> reconcile/monitor**. Never execute directly from an input change. Display exact asset, recipient, amount, fees, gas reserve (when returned), total debit and expiry, plus the route's minimum output/delivery fee when applicable. Do not synthesize fee amounts or substitute a new quote after approval.

| Operation | Quote | After explicit approval | Completion |
| --- | --- | --- | --- |
| Direct deposit | quoteDeposit | prepareReviewedDeposit, executeDeposit | reconcileDeposit |
| Private transfer | quotePrivateSend | prepareReviewedPrivateSend, executePrivateSend | reconcilePrivateSend |
| Public withdrawal | quoteWithdrawal (enhanced:false) | prepareReviewedWithdrawal, authorizeWithdrawal | monitorWithdrawal |
| Enhanced withdrawal | quoteWithdrawal (enhanced:true) | prepareReviewedWithdrawal, authorizeWithdrawal | monitorWithdrawal; all 3 claims finalized |
| Public batch | quotePublicBatch | prepareReviewedPublicBatch, authorizePublicBatch | monitorPublicBatch |
| Swap | quoteRoute (4), quoteRouteFees | prepareReviewedRoute, executeRoute | reconcileRoute, verified output |
| Bridge | quoteRoute (5), quoteRouteFees | prepareReviewedRoute, executeRoute | reconcileRoute, verified destination delivery |
| Public payment link | openStealthOSPublicPayment, quotePayment | prepareReviewedPayment, executePayment | reconcilePayment |

The deposit preparation wrapper already checks/requests token allowance when required; use the separate approveDepositAsset/approvePaymentAsset only if the UX explicitly stages the same reviewed allowance. An allowance approval is not a deposit. For routes, pass the same reviewed amount, receiver, minimum output, maximum delivery fee and slippage into quoteRouteFees. Use configured routes only. A private-output swap and a bridge can remain incomplete after source inclusion. A public payment link does not create a payer's private wallet.

See [transaction examples](TRANSACTIONS.md) for exact invocation sequences and [API reference](API_REFERENCE.md) for method and result links. The [reference application](../examples/vanilla-js/) demonstrates the same flows with an explicit quote and execute UI.

## 6. Recovery, fees and failure handling

Read fees from each operation's SDK quote and current registered policy. Deposit quotes expose amountAtomic, protocolFeeAtomic, partnerFeeAtomic and netAmountAtomic; do not assume totalDebitAtomic exists on deposits. Public wallet gas is additional. Withdrawal and batch quotes expose net payout, protocol/partner fees, gas reserve, total debit and expiry. Render all values using the asset's decimals. Do not hard-code basis points or infer fees from an unrelated asset. See [fees](FEES.md).

Persist no private state in application telemetry. The SDK's encrypted local journal records prepared/submitted operations. Reopen the same account/network/asset and use the list/history methods and original IDs to reconcile. On timeouts or uncertain broadcasts, do not resend; display pending/uncertain, recover canonical state and retain reservations until the SDK establishes the outcome. Never treat inclusion as finality. Handle explicit user rejection differently from ambiguous transport errors. See [error handling](ERROR_HANDLING.md) and [wallet recovery](WALLET_RECOVERY.md).

## 7. Testnet acceptance

Before handing the integration to users, demonstrate each enabled flow with real Chikyu testnet receipts and the exact signed archive/configuration. Check native and enabled ERC20 deposits, allowance rejection, recipient recovery, private transfer, normal and enhanced withdrawal, public batch, available swap and CCIP routes, handle claims and public payment links. Exercise expired quotes, insufficient funds, account/chain switches, disconnected RPC, reload after submission, repeated clicks, encrypted backup restore on a second device and mobile browser behavior. Verify correct balance, fee debit, recipient output, canonical finality and no duplicate submissions.

The signed deployment and candidate audit remediation are distinct. Record the SDK version, generation, test origin, supported operation, sanitized result and public receipt IDs. Do not share recovery words or private transaction journals. Mainnet release requires separate final ceremony, deployment and activation validation.

## 8. Resources and next action

- [Partner portal](https://partners.stealthos.xyz)
- [SDK repository](https://github.com/stealthos-xyz/vanta-sdk)
- [Signed release](../releases/0.4.65/publication.json)
- [Solidity contracts and deployed source manifest](https://github.com/stealthos-xyz/contracts)
- [Audit report and adversarial findings](audit/README.md)
- [Full integration guide](PARTNER_INTEGRATION.md)
- [Framework notes](FRAMEWORKS.md) · [Upgrades](UPGRADING.md)

DogeOS engineering can begin by registering the test origin and downloading its configuration, then building the reference app and completing the acceptance checklist. Reference examples require that real registration, supported routes, connected test wallet and working service/RPC endpoints are available. No live partner acceptance run is represented by this documentation.
