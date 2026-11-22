# Vanta SDK

Integrate a private StealthOS wallet into a browser app on DogeOS Chikyu. This is the standalone source repository for `@stealthos/vanta-sdk`. The current partner release is **0.4.58**.

## Install the signed SDK

The release directory contains the same npm archive used by the StealthOS wallet. Install it in your app and commit the resulting lockfile.

```sh
npm install --save-exact https://raw.githubusercontent.com/stealthos-xyz/vanta-sdk/d7c5275b34f1b4ed9309e0fb01eb8ea94475df49/releases/0.4.58/stealthos-vanta-sdk-0.4.58.tgz
```

Archive SHA-256 is `f042d2b5adf552fe3077f937883c77e981de7fd7ffb06d3d759e9c72f5bd9f7e`. The signed publication records the archive hash, byte count, network, deployment generation and proof resources. [Signed publication](releases/0.4.58/publication.json) · [Live publication](https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/current).

## Connect your application

1. Register your partner handle, supported assets, fees and exact HTTPS app origin in the [partner portal](https://partners.stealthos.xyz). Download your application's public configuration for SDK 0.4.58.
2. Serve the configuration on your app origin. Copy the worker build example into your project as `build-workers.mjs`, then run these commands to write the wallet and proof workers to `public/stealthos/`. [0.4.58 worker build example](examples/build-workers.mjs).

   ```sh
   npm install --save-dev esbuild
   node build-workers.mjs
   ```

   Your content security policy must allow module workers, WebAssembly, and connections to the HTTPS services in your configuration.

3. Pass the EIP-1193 provider selected by your wallet connector. The SDK checks the registered origin and signed deployment. The customer's wallet signs its service session on demand.

   ```js
   import {openStealthOSPartnerApp} from '@stealthos/vanta-sdk';

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

The returned client supports wallet creation and restoration, fee review, transaction preparation, submission and reconciliation. Your application presents the customer's approval for each funded action. Partners share the existing Chikyu ceremony, contracts and pools. [0.4.58 integration guide](packages/vanta-sdk/PARTNER_INTEGRATION.md) · [Partner client types](packages/vanta-sdk/api/wallet.d.mts).

## Migrating from 0.4.57

Replace `@stealthos/vanta-sdk/partner-app` with `@stealthos/vanta-sdk` for wallet and public-payment clients. Point the build at `/worker` and `/proof-worker`. Apps that read network metadata, enroll partners, or provide independent wallet recovery can opt into `/network`, `/setup`, or `/recovery`. [Public entry points](packages/vanta-sdk/README.md)

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
