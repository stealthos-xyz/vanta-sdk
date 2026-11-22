# Vanta SDK

Integrate a private StealthOS wallet into a browser app on DogeOS Chikyu. This is the standalone source repository for `@stealthos/vanta-sdk`. The current partner release is **0.4.57**.

## Install the signed SDK

The release directory contains the same npm archive used by the StealthOS wallet. Install it in your app and commit the resulting lockfile.

```sh
npm install --save-exact https://raw.githubusercontent.com/stealthos-xyz/vanta-sdk/fa847262abe31691f25fba98183ac21a9cc06b5f/releases/0.4.57/stealthos-vanta-sdk-0.4.57.tgz
```

Archive SHA-256 is `ebd277014ddf18a8d25e9c9166162900070918df6f4d9b855c53f3c86443b9e0`. The signed publication records the archive hash, byte count, network, deployment generation and proof resources. [Signed publication](releases/0.4.57/publication.json) Â· [Live publication](https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/current).

## Connect your application

1. Register your partner handle, supported assets, fees and exact HTTPS app origin in the [partner portal](https://partners.stealthos.xyz). Download your application's public configuration for SDK 0.4.57.
2. Serve the configuration on your app origin. Copy the worker build example into your project as `build-workers.mjs`, then run these commands to write the wallet and proof workers to `public/stealthos/`. [0.4.57 worker build example](https://github.com/stealthos-xyz/vanta-sdk/blob/90841953421d10397175ade996b609835ba0e53a/examples/build-workers.mjs).

   ```sh
   npm install --save-dev esbuild
   node build-workers.mjs
   ```

   Your content security policy must allow module workers, WebAssembly, and connections to the HTTPS services in your configuration.

3. Pass the EIP-1193 provider selected by your wallet connector. The SDK checks the registered origin and signed deployment. The customer's wallet signs its service session on demand.

   ```js
   import {openStealthOSPartnerApp} from '@stealthos/vanta-sdk/partner-app';

   export async function openWallet(provider) {
     const response = await fetch('/stealthos-partner-config.json');
     if (!response.ok) throw new Error('Partner configuration unavailable');
     return openStealthOSPartnerApp({
       configuration: await response.json(),
       provider,
       workerUrl: '/stealthos/app-wallet-worker.mjs',
     });
   }
   ```

The returned client supports wallet creation and restoration, fee review, transaction preparation, submission and reconciliation. Your application presents the customer's approval for each funded action. Partners share the existing Chikyu ceremony, contracts and pools. [0.4.57 integration guide](https://github.com/stealthos-xyz/vanta-sdk/blob/90841953421d10397175ade996b609835ba0e53a/packages/vanta-sdk/PARTNER_INTEGRATION.md) Â· [Partner client types](packages/vanta-sdk/browser/partner-app.d.mts).

## 0.4.58 migration

For the next testnet release, import the wallet and payment clients from the package root. Use `/worker` and `/proof-worker` when building your app. Optional deployment, enrollment and recovery APIs live under `/network`, `/setup` and `/recovery`. [Candidate API](packages/vanta-sdk/README.md) · [Candidate worker build example](examples/build-workers.mjs)

## Develop the SDK

Use Node 24.14.1 and npm 11.11.0 for the release checks.

```sh
npm ci
npm run verify:release
npm test
npm run build
```

The SDK lives in `packages/vanta-sdk`. Its shared TypeScript build inputs live in `packages/sdk/src`. Both are included in this repository. The build compiles the wallet, proof drivers, workers using the signed public Chikyu deployment inputs. A developer build is a candidate for a future release.

`verify:release` verifies the operator signature and reproduces the published npm archive byte for byte from the checked-in release files. Partners should pin a signed archive and its matching configuration for each upgrade. The StealthOS release process publishes and activates changes to executable SDK bytes. Partners can use this release to integrate their applications with StealthOS. Bundled dependencies retain their [third-party notices](packages/vanta-sdk/dist/vendor/THIRD_PARTY_NOTICES.txt).
