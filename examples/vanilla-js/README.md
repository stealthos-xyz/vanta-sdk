# DogeOS partner reference app (vanilla ESM)

A small browser integration for the signed 0.4.65 SDK. It demonstrates connected wallet onboarding, encrypted backup, receiving addresses/handles, asset selection and balances, all reviewed funded operations, and manual history reconciliation. It is a testnet engineering reference, not a production wallet UI or a live acceptance certificate.

1. Register the HTTPS app origin and supported assets at https://partners.stealthos.xyz. Download the matching 0.4.65 configuration with independent RPC endpoints.
2. From this directory run `npm install`, then save the lockfile in your own integration repository. The SDK archive and esbuild versions are pinned.
3. Put your downloaded public JSON at `public/stealthos-partner-config.json`.
4. Run `npm test` for isolated flow tests (mock SDK, no funds) and `npm run build`. Deploy `public/` to the exact registered HTTPS origin. The build creates app.mjs and the two required worker files.
5. Connect an injected EIP-1193 wallet on Chikyu (6281971). For other connectors, replace the provider-selection adapter with your existing wallet connector. No secrets or funded test credentials are included.
6. Create or restore, recover balances, enter positive integer atomic units, request a quote, review exact terms, explicitly approve and submit. The app intentionally shows raw quote/result fields locally for engineering inspection; build a production human-readable amount/status UI using the fee and lifecycle guides. Do not screen-share private details or use developer console logs for secrets.
7. For a public payment link, connect payment mode using the encoded private receiving address. For swap/bridge use an enabled route and its supported receiver. For batch use a JSON array of public recipients and atomic amounts. Do not send funds to unverified addresses.
8. For pending or uncertain operations, select the original asset/operation, read history and reconcile using the original preparedId or transactionId. Never repeat submission automatically. Use encrypted backup export/import for recovery testing.

The reference app uses a browser confirmation for phrase storage; replace it with your trusted secure local UI. Test account and chain changes, page background, CSP, RPC failures, native and token deposits, all enabled operations, mobile performance and restore before release. Not all SDK extensions (such as advanced historical generation exit UI) are implemented in the demo; see the recovery guide.

[Implementation guide](../../docs/DOGEOS_PARTNER_GUIDE.md) · [Transactions](../../docs/TRANSACTIONS.md) · [Errors](../../docs/ERROR_HANDLING.md) · [Frameworks](../../docs/FRAMEWORKS.md)
