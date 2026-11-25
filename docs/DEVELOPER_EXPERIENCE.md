# Developer experience (signed SDK 0.4.66)

**Status: signed and activated on DogeOS Chikyu testnet, 25 November 2026.** Use the [signed release](../releases/0.4.66/publication.json) and matching registered configuration. Do not use a 0.4.65 configuration with the 0.4.66 package.

## Simpler onboarding

The existing partner wrapper remains the primary ESM entry point. The partner handle is bound from the registered configuration; passing it to a quote or preparation method is no longer required in TypeScript. Legacy calls still compile, and the configuration's registered handle overrides any caller value.

Install esbuild in the application and run `npx vanta-setup-workers` after installing the matching signed SDK. An optional output-directory argument defaults to `public/stealthos`. The wallet and proof workers must remain together on the registered HTTPS origin. Existing manual worker installation is supported.

## Progress and errors

`openStealthOSPartnerApp({configuration, provider, workerUrl, onProgress})` and public payment accept an optional lifecycle callback. Events contain method, stage, state and optional sanitized error code. Stages distinguish connecting, wallet, synchronization, quoting, preparation, authorization, reconciliation and history. These are coarse method lifecycle notifications, not proof percentages, cryptographic attestations or confirmed receipts. Observers cannot approve a transaction or change its result. Completion means the method returned, not necessarily the transaction finalized. Do not log private state.

Use `normalizeVantaError(error, {submissionMayHaveStarted})` to obtain a `VantaSdkError` with a documented code and conservative recovery action. The helper never copies raw upstream messages or request data. If submission may have started, reconcile the original ID; do not automatically resend. Existing methods preserve their original exception behavior.

## Transaction results

Ordinary withdrawal authorization/monitoring returns the normal review with `preparedId`; enhanced authorization returns `transactionId` and status; enhanced monitoring returns the claim status. The public overloads now reflect those actual response shapes. Use `VANTA_ROUTE.SWAP` and `VANTA_ROUTE.BRIDGE` instead of numeric route literals. Routed reviews include `private-output-pending` and typed destination delivery evidence.

Use `wallet.reconcileTransaction({operation, id, historyAsset})` to get a consistent display status through the existing reconciliation methods. Operations are deposit, private-send, withdrawal, enhanced-withdrawal, public-batch, swap and bridge. Public payment clients accept `reconcileTransaction({id, transactionHash})`. The original method APIs are unchanged. The returned object includes id, operation, phase, complete, transactionHash and outputTransactionHash. Use only original local journal IDs. Reconciliation can resume existing authorized recovery work; it is not permission to authorize a new payment.

For enhanced claims and bridge/private swap outputs, completion requires the respective claim/destination/output evidence, not source inclusion alone. The pure `normalizeVantaTransactionStatus` helper is for **display of trusted SDK results only**; it is not an independent chain verifier, new spend authorization or a substitute for the SDK's canonical checks.

## References and compatibility

- [Vanilla reference application](../examples/vanilla-js/) covers all enabled flows.
- [React reference](../examples/react/) demonstrates wallet lifecycle and reviewed deposit. Reuse its client component in Next.js; [framework notes](FRAMEWORKS.md) explain the browser boundary.
- [Security policy](../SECURITY.md), [licensing status](../LICENSING.md) and [release procedure](RELEASE_PROCESS.md).

The historical signed 0.4.65 release remains intact. 0.4.66 additionally includes FYEO-related wallet credential and nonce reconciliation changes. Private-wallet passwordless unlock is disabled; the public-payment journal remains separate. The activated software release preserves the existing ceremony, proof bindings and deployed contract graph. A separate new contract deployment is required for contract-side remediation. Reference apps and CI are non-funded qualification; each partner must complete its own live registered-origin testnet acceptance.
