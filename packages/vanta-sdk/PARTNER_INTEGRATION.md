# Partner application integration

Register your private partner handle, assets, fees and app origins in the partner portal. Download the public configuration and matching signed SDK archive. Partners do not deploy pools, perform ceremonies, host an authorization endpoint or put recovery credentials on a backend.

SDK 0.4.0 requires the direct-deposit deployment generation. Its bootstrap reuses the completed ceremony and proof artifacts. It is a source candidate until the new contracts, exact SDK archive and operator publication are activated. Pin the published archive digest and retain the package lockfile; do not relabel an old deployment as direct-deposit capable.

## Browser application

```js
import { openStealthOSPartnerApp } from '@stealthos/vanta-sdk/partner-app';
import configuration from './stealthos-partner-config.json';

// DogeOS: pass useAccount().currentProvider, the connected EVM provider.
const wallet = await openStealthOSPartnerApp({
  configuration,
  provider,
  workerUrl: '/stealthos/app-wallet-worker.mjs',
});
```

Bundle `@stealthos/vanta-sdk/browser/worker` as a module worker on your app origin. For an esbuild project:

```sh
npx esbuild node_modules/@stealthos/vanta-sdk/browser/app-wallet-worker.mjs --bundle --platform=browser --format=esm --outfile=public/stealthos/app-wallet-worker.mjs
```

Your CSP must allow that worker, the configured HTTPS RPC/service/artifact origins and WebAssembly compilation. Keep transaction and key approvals in trusted application UI. Account or network changes lock the wallet; opening a wallet extension or switching tabs does not reset it.

`createPrivateWallet` and `restoreWallet` manage the customer's private identity. It is separate from the partner's fee wallet. The SDK provides encrypted browser storage, review/execute/reconcile APIs for deposit and private transfer, receiving addresses, note recovery, swap/bridge routes and the enhanced withdrawal host. Call `getEnhancedHost()` for withdrawal and enhanced privacy controls. The app's partner handle is bound by `openStealthOSPartnerApp`; customers never choose it.

The shared service authenticates each customer for a specific partner, origin, network and deployment. No protocol JWT or HMAC secret is given to the partner. Use the configured swap and bridge routes; unsupported venue/network combinations do not become available through registration. SwapKit Chikyu support still requires DogeOS's provider integration.

## Direct deposits and native wallet screening

The SDK starts StealthOS's own native screening when the customer creates or restores a wallet. A short-lived, revocable clearance covers the connected funding address and the sealed deployment's assets. Valid clearances are reused across deposits; their checks do not send another assessment request. Expired clearances or changed funding addresses need a new assessment. No third-party screening vendor or partner-hosted signing service is involved.

The SDK builds each deposit intent and generates its KZG proof in the customer's browser. Their connected wallet sends the deposit directly to the pool. The contract verifies clearance, current registered partner fees and collector, intent/domain binding, nonce, expiry, value conservation and the existing combined proof. Neither a partner nor a protocol service signs a per-deposit quote.

Partners share pools per network and asset. Owner-authorized registry updates change their operation fees without a new SDK or pool deployment. A stale pending intent must be prepared again and reviewed before submission. Public app configuration selects a partner policy; it does not cryptographically prove that a transaction originated from a specific website.

## Lifecycle

Publish your app with its downloaded public configuration and test deposits, withdrawals, receiving, transfers, enhanced privacy and available routes from that app. Manage supported assets in the portal. Newly added assets require their registration transaction; hiding an asset does not revoke withdrawal or recovery access. Preserve pending journals and reconcile uncertain submissions instead of automatically sending replacements. Pin SDK upgrades explicitly and preserve historical pool recovery.

### Deposit review and public artifact warmup

Use `quoteDeposit({amountAtomic})` to show current fees before generating a proof.
After the customer confirms that review, call `prepareReviewedDeposit({quoteId})`,
then `executeDeposit({preparedId})`. The worker rejects expired reviews and changed
fees, policy revisions or receiving identities before building the deposit proof.
The final pool, screening, nonce, balance, simulation and exact-transaction checks
remain mandatory before the wallet request. Existing `prepareDeposit` callers
retain the original prepare-first API.

Wallet creation, restoration and unlock start nonblocking downloads of the
compiled, public deposit artifacts. The browser cache checks exact size and
SHA-256 on reuse, shares concurrent warmup/prover requests and falls back to
network access if storage is unavailable. It never stores private witnesses,
recovery words or a trusted deployment flag. Wallet home does not wait for warmup.
