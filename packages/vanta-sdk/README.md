# Vanta partner SDK

Use `openStealthOSPartnerApp` from `@stealthos/vanta-sdk` to connect a registered application to the DogeOS Chikyu wallet. The partner supplies its public configuration, the customer's selected wallet provider, and the URL of its locally hosted wallet worker.

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
