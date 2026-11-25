# Vanta partner SDK

Use `openStealthOSPartnerApp` from `@stealthos/vanta-sdk` to connect a registered application to its supported privacy wallet deployment. The partner supplies its public configuration, the customer's selected wallet provider, and the URL of its locally hosted wallet worker.

## Developer tools

Use `onProgress` for sanitized operation lifecycle updates and `normalizeVantaError` to obtain a typed error and recovery action. `reconcileTransaction` provides one display-status interface for the existing transaction journals. A completed method is not necessarily a finalized transaction. The partner handle is injected from the registered configuration.

Install esbuild in your application and run `npx vanta-setup-workers` to create the two browser worker files. Host the generated files together on your registered HTTPS origin.

## Entry points

| Import | Purpose |
| --- | --- |
| `@stealthos/vanta-sdk` | Open a wallet or payment link, review transactions, and format private addresses, handles and memos |
| `/worker` | Bundle the wallet's module worker |
| `/proof-worker` | Copy the standalone proof worker beside the wallet worker |
| `/network` | Read deployment metadata, proof resources, confirmation policy and protocol fees |
| `/setup` | Implement partner enrollment and asset configuration |
| `/recovery` | Integrate a local recovery vault and historical generations |

Pin the exact archive and configuration from your signed release. [Partner integration](./PARTNER_INTEGRATION.md)
