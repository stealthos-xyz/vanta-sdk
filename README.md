# Vanta SDK

Integrate a private StealthOS wallet into your application on DogeOS Chikyu using the standalone, ESM-first `@stealthos/vanta-sdk`.

**Current signed partner release: 0.4.65** · DogeOS Chikyu testnet (chain ID 6281971) · Updated 24 November 2026.

## Start here

| Resource | What you will find |
| --- | --- |
| [Partner integration guide](docs/PARTNER_INTEGRATION.md) | Registration, setup, wallet lifecycle, fee review, all supported transaction flows, recovery and launch checklist |
| [Signed SDK release](releases/0.4.65/) | Exact released npm archive and operator-signed publication |
| [Audit report (PDF)](docs/audit/Vanta_DOGE_Audit_Report_2026-11-24.pdf) | Full 28-page audit, including cryptography, adversarial security checks, findings and remediation |
| [Audit findings and assurance summary](docs/audit/README.md) | At-a-glance evidence, finding dispositions, scope and release boundaries |
| [API reference](packages/vanta-sdk/api/wallet.d.mts) | Public exports and types |
| [Wallet client method types](packages/vanta-sdk/browser/app-wallet.d.mts) | Exact method signatures for integration |
| [Worker build example](examples/build-workers.mjs) | ESM wallet worker and standalone proof worker |

## 1. Install the signed SDK

```sh
npm install --save-exact https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/artifacts/objects/097e12aad803a824d4aab872cfd612b53195f510f91a2e799a00d29bb5e00940.tgz
```

Commit your application's lockfile. The identical archive is also mirrored in [releases/0.4.65](releases/0.4.65/stealthos-vanta-sdk-0.4.65.tgz).

- SHA-256: `097e12aad803a824d4aab872cfd612b53195f510f91a2e799a00d29bb5e00940`
- Size: 1,659,865 bytes
- Source: [signed wrapper source revision](https://github.com/stealthos-xyz/vanta-sdk/commit/8d84ae5b5f302a61a9daa7fb0a5bbc059c06c47c)
- [Signed publication](releases/0.4.65/publication.json) · [Live publication](https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/current)

Always use the configuration and worker assets for the same signed version and deployment generation. A development build or a candidate archive is not a signed release.

## 2. Register and connect your application

Register your partner handle, supported assets, fees and exact HTTPS application origin in the [partner portal](https://partners.stealthos.xyz). Download the public configuration matching SDK 0.4.65. Serve it from your application origin.

Copy [examples/build-workers.mjs](examples/build-workers.mjs) to your application, then:

```sh
npm install --save-dev esbuild
node build-workers.mjs
```

This produces the module wallet worker and proof worker under `public/stealthos/`. The app must permit module workers, WebAssembly and HTTPS connections to its configured services.

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

Use the EIP-1193 provider selected by the customer's wallet connector. For production-style integrations, configure distinct HTTPS origins for primary and verification RPCs. The SDK validates its signed release and registered origin, authenticates sessions, and keeps proving and recovery material in the customer's local wallet environment.

Continue with the [complete partner integration guide](docs/PARTNER_INTEGRATION.md).

## Release 0.4.65

The current release includes selected-asset recovery isolation, canonical transaction reconciliation, independent RPC support, shared public history checkpoints, adaptive log recovery, corrected rejected-deposit states and faster fee reviews and proof warmup across the supported transaction flows.

Use the package root for wallet and public-payment clients; use `/worker` and `/proof-worker` for worker assets. Optional network metadata, enrollment and recovery APIs live under `/network`, `/setup` and `/recovery`. See [public entry points](packages/vanta-sdk/README.md).

## Security and audit

The agreed internal DOGE fund-safety audit register is closed with zero assigned items outstanding. The [full audit report](docs/audit/Vanta_DOGE_Audit_Report_2026-11-24.pdf) and [findings summary](docs/audit/README.md) explain the tested controls, including adversarial checks, and distinguish historical/deployed evidence from new candidate evidence. This is scoped engineering assurance, not third-party certification or approval to custody mainnet funds. Candidate contract remediation applies only to the matching future deployment.

## Develop and verify the SDK

Use Node 24.14.1 and npm 11.11.0.

```sh
npm ci
npm run verify:release -- 0.4.65
npm test
npm run build
```

The source is in `packages/vanta-sdk` and shared TypeScript build inputs in `packages/sdk/src`. `verify:release` verifies the operator signature, package digest and byte-for-byte reproduction of the archived signed package. The build command creates a development candidate. Repository-level integration documentation is maintained separately from the immutable signed archives; the bundled documentation is retained exactly as released.

See [third-party notices](packages/vanta-sdk/dist/vendor/THIRD_PARTY_NOTICES.txt).
