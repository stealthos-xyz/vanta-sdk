# StealthOS SDK partner integration

See [PARTNER_INTEGRATION.md](PARTNER_INTEGRATION.md) for the browser adapter and public configuration. SDK 0.4.0 adds direct deposits and reusable native wallet screening. Partners do not host an authorization service or wallet credentials.

# StealthOS SDK 0.4.16

The package import remains `@stealthos/vanta-sdk`. Release versions use the
source package version (current candidate: `0.4.16`). Generation IDs, source commits
and artifact hashes are recorded separately in the signed publication; they
are not appended to the product version. This source change does not replace
an already activated SDK archive.

For outward quote methods, `amountAtomic` is the total spending budget. Protocol
fees, partner fees and gas reimbursement are deducted inside that budget.
`grossAmountAtomic` records the entered budget; `amountAtomic` (or enhanced
`netPayoutAtomic`) in the returned review is the recipient/route amount after
deductions. `totalDebitAtomic` never exceeds the budget. Atomic rounding residue
and the circuit's required private change remain with the sender. Quotes and fee
reviews never generate a transaction proof; confirmation precedes proving.

This ESM candidate implements the current eleven-role KZG family interface. The source package is unconfigured: official signed release, network deployment, final proving resources and reviewed host policy must be compiled together before any custody flow can open.

Public integration entry points:

- `/family-enhanced-host`: local note selection, authorization, private-fee proving, explicit host consent, durable submission and canonical reconciliation.
- `/family-deposit-host`: current-family deposits with configurable partner fees, zero protocol fees and exact wallet transaction approval and durable ambiguous-submission handling.
- `/family-partner-signup`: current family handle and partner enrollment using signed credential resources and KZG registry state.
- `/wallet`, `/host-wallet`, `/host-storage`, `/host-worker`: local identity and encrypted host integration.
- `/family-network`, `/family-proof-resources`, `/family-proofs`: signed current release validation and streamed proof runtimes.
- `/family-wallet-generations`, `/family-exit-host`: approved historical KZG pool selection and relayer-independent full-note recovery withdrawals with their original artifacts and immutable exit fees.
- `/family-sdk-update`: checks a signed proposal against a separately approved archive digest; never installs or executes an update.
- `/wallet-core`: public cross-origin recovery connector. Words and approvals stay in the independently hosted wallet window.

The host requires separate verification clients and authenticated final resource hashes. Chikyu uses its one public RPC endpoint for both clients. Ordinary authorization and claim components use the typed 19- and 15-input interfaces. KZG private-fee relations use 40 and 41 inputs. Funded note and fee proving uses STREAM_BOUND4 and four local workers. Necessary note and nullifier trees remain part of the protocol.

Importing the package or passing an application URL cannot select or activate a deployment. The current candidate retains qualification safety gates until final issued-key replay and consumer acceptance complete. No official ceremony, deployment or funds test is implied by a successful source build.

`npm test` runs the current-family boundary and type checks. `npm pack` rebuilds the package and verifies the complete public export/type/import closure. Approved KZG deployment history is compiled as signed public metadata. Historical exits use the current SDK implementation and the original pool’s pinned proving artifacts; no earlier SDK executable or older policy engine is loaded. Unrelated historical prototypes remain excluded from the package.

Wallet activity: use `listDepositHistory()` for the complete encrypted deposit journal, including confirmed deposits. `listPendingDeposits()` remains limited to actionable pending deposits. Use `listWithdrawals()` for both regular and enhanced withdrawals; regular records include their total private debit for history display. These methods only read saved activity.
# Public-wallet payment links

Use `openStealthOSPublicPayment` from `@stealthos/vanta-sdk/partner-app` to pay a
current, pool-bound receiving address from an ordinary EOA. This flow creates no
private wallet, recovery phrase or wallet password for the payer. It uses the
same signed partner configuration, local browser WASM, native screening and
direct-deposit contract checks as regular deposits.

```js
const payment = await openStealthOSPublicPayment({
  configuration, provider, recipient, workerUrl: '/family-wallet-worker.mjs'
});
const quote = await payment.quotePayment({ amountAtomic: '1000000000000000000' });
// Show the amount, partner fee, recipient and net receipt for explicit review.
// Network gas is paid separately by the payer's connected EOA.
await payment.approvePaymentAsset({ quoteId: quote.quoteId }); // ERC-20 only
const prepared = await payment.prepareReviewedPayment({ quoteId: quote.quoteId });
const sent = await payment.executePayment({ preparedId: prepared.preparedId });
// Poll read-only; never resubmit an uncertain payment.
const status = await payment.reconcilePayment({ preparedId: sent.preparedId });
payment.dispose();
```

The SDK binds the recipient, asset, chain, generation and pool to the reviewed
payment. Its encrypted device journal saves uncertain submissions, and canonical
receipts verify the exact transaction plus recipient and fee outputs. Use
`listPendingPayments()` after reconnecting; `reconcilePayment` can also accept a
transaction hash recovered from the payer's wallet. Only the recipient needs
their private wallet to recover and spend the payment.
