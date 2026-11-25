# Vanta SDK

Integrate a private StealthOS wallet into your application on a supported deployment using the standalone, ESM-first `@stealthos/vanta-sdk`.

**Current signed partner release: 0.4.66** · DogeOS Chikyu testnet (chain ID 6281971) · Updated 25 November 2026.

## Start here

**Developer experience (0.4.66):** [API and migration guide](docs/DEVELOPER_EXPERIENCE.md) · [React example](examples/react/) · [Release process](docs/RELEASE_PROCESS.md) · [Developer portal source](docs/index.html). Use the activated, immutable archive below.

**Partner engineering:** Start with the [partner implementation guide (PDF)](docs/StealthOS_Vanta_Partner_Implementation_Guide.pdf) or [Markdown guide](docs/PARTNER_IMPLEMENTATION_GUIDE.md), [quickstart](docs/QUICKSTART.md) and [reference application](examples/vanilla-js/). See the [public Solidity contracts](https://github.com/stealthos-xyz/contracts).

| Resource | What you will find |
| --- | --- |
| [Partner integration guide](docs/PARTNER_INTEGRATION.md) | Registration, setup, wallet lifecycle, fee review, all supported transaction flows, recovery and launch checklist |
| [Signed SDK release](releases/0.4.66/) | Immutable archive download and operator-signed publication |
| [Audit report (PDF)](docs/audit/Vanta_DOGE_Audit_Report_2026-11-24.pdf) | Full 28-page audit, including cryptography, adversarial security checks, findings and remediation |
| [FYEO security code review + remediation results (PDF)](docs/audit/FYEO_StealthOS_Audit_with_Remediation_Results.pdf) | Original external scan and follow-up results: all 14 original findings no longer reported |
| [Audit findings and assurance summary](docs/audit/README.md) | At-a-glance evidence, finding dispositions, scope and release boundaries |
| [API reference](packages/vanta-sdk/api/wallet.d.mts) | Public exports and types |
| [Wallet client method types](packages/vanta-sdk/browser/app-wallet.d.mts) | Exact method signatures for integration |
| [Worker build example](examples/build-workers.mjs) | ESM wallet worker and standalone proof worker |

Detailed references: [API](docs/API_REFERENCE.md) · [configuration](docs/CONFIGURATION.md) · [transactions](docs/TRANSACTIONS.md) · [fees](docs/FEES.md) · [recovery](docs/WALLET_RECOVERY.md) · [errors](docs/ERROR_HANDLING.md) · [browser](docs/BROWSER_COMPATIBILITY.md) · [frameworks](docs/FRAMEWORKS.md) · [architecture](docs/ARCHITECTURE.md) · [upgrades](docs/UPGRADING.md) · [changelog](CHANGELOG.md).

## 1. Install the signed SDK

```sh
npm install --save-exact https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/artifacts/objects/27b20569f7fafcb6700bbc6ad6f2aa157651184ffbd46d4f11d5f8c13f649d97.tgz
```

Commit your application's lockfile. The exact archive is hosted at its content-addressed [StealthOS release URL](https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/artifacts/objects/27b20569f7fafcb6700bbc6ad6f2aa157651184ffbd46d4f11d5f8c13f649d97.tgz). The signed publication and download details are retained in [releases/0.4.66](releases/0.4.66/); previous repository archives remain intact.

- SHA-256: `27b20569f7fafcb6700bbc6ad6f2aa157651184ffbd46d4f11d5f8c13f649d97`
- Size: 1,667,080 bytes
- Source: [signed wrapper source revision](https://github.com/stealthos-xyz/vanta-sdk/commit/1fb933321f71170e5d71ba0ae7a67f7d048bc360)
- [Signed publication](releases/0.4.66/publication.json) · [Live publication](https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/current)

Always use the configuration and worker assets for the same signed version and deployment generation. A development build or a candidate archive is not a signed release.

## 2. Register and connect your application

Register your partner handle, supported assets, fees and exact HTTPS application origin in the [partner portal](https://partners.stealthos.xyz). Download the public configuration matching SDK 0.4.66. Serve it from your application origin.

Install esbuild and use the shipped worker setup command:

```sh
npm install --save-dev esbuild
npx vanta-setup-workers
```

The manual [worker builder](examples/build-workers.mjs) remains supported.

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

## Release 0.4.66

0.4.66 retains 0.4.65's fast fee reviews, independent RPC checks, recovery and reconciliation. It adds typed developer APIs, progress/error helpers and a worker setup command, plus FYEO-related wallet credential and nonce reconciliation protections. Private-wallet passwords are mandatory; passwordless unlock is disabled. Public-payment journals remain separately scoped. The signed software release preserves the existing deployed contracts and ceremony.

Use the package root for wallet and public-payment clients; use `/worker` and `/proof-worker` for worker assets. Optional network metadata, enrollment and recovery APIs live under `/network`, `/setup` and `/recovery`. See [public entry points](packages/vanta-sdk/README.md).

## Security and audit

**External FYEO security code review:** [Read the original report and remediation addendum (PDF)](docs/audit/FYEO_StealthOS_Audit_with_Remediation_Results.pdf). The supplied FYEO rescan results show that all 14 original findings are no longer reported. The original six report pages are retained unchanged; the seventh page is a StealthOS-prepared record of the rescan. This result is scoped to the original findings and does not establish that all deployed contract changes have been activated.

The agreed internal DOGE fund-safety audit register is closed with zero assigned items outstanding. The [full audit report](docs/audit/Vanta_DOGE_Audit_Report_2026-11-24.pdf) and [findings summary](docs/audit/README.md) explain the tested controls, including adversarial checks, and distinguish historical/deployed evidence from new candidate evidence. This is scoped engineering assurance, not third-party certification or approval to custody mainnet funds. Candidate contract remediation applies only to the matching future deployment.

## Develop and verify the SDK

Use Node 24.14.1 and npm 11.11.0.

```sh
npm ci
npm run verify:release -- 0.4.66
npm test
npm run build
```

The source is in `packages/vanta-sdk` and shared TypeScript build inputs in `packages/sdk/src`. `verify:release` verifies the operator signature, package digest and byte-for-byte reproduction of the archived signed package. The build command creates a development candidate. Repository-level integration documentation is maintained separately from the immutable signed archives; the bundled documentation is retained exactly as released.

See [security policy](SECURITY.md), [licensing status](LICENSING.md) and [third-party notices](packages/vanta-sdk/dist/vendor/THIRD_PARTY_NOTICES.txt).
