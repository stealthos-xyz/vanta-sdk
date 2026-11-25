# Transaction integration examples

The [reference flow module](../examples/vanilla-js/src/flows.mjs) provides executable ESM implementations for every flow below. All examples use a connected, unlocked wallet and downloaded configuration. Public payment uses a separate client. Each quote must be displayed in full, with exact recipient and fees, and approved explicitly by the customer before calling the next method. Treat local quote and preparation IDs as sensitive. Never send private memo text to analytics. Use only decimal integer strings in atomic units.

## Deposit

```js
const quote = await wallet.quoteDeposit({amountAtomic, partnerHandle});
// Display quote, including netAmountAtomic and fees; obtain explicit approval.
const prepared = await wallet.prepareReviewedDeposit({quoteId: quote.quoteId});
const sent = await wallet.executeDeposit({preparedId: prepared.preparedId});
const state = await wallet.reconcileDeposit({preparedId: sent.preparedId, transactionHash: sent.transactionHash});
```

The wrapper handles any required ERC20 approval inside prepareReviewedDeposit. A separately staged approveDepositAsset({quoteId}) is optional and must be approved against that same quote. Do not label the allowance as a deposit. Native deposit gas is paid by the connected public wallet.

## Private send

```js
const recipient = await wallet.resolveHandle(handle);
// Or decodeVantaFamilyReceivingAddress(encodedAddress) from the package root.
const quote = await wallet.quotePrivateSend({recipient, amountAtomic, partnerHandle});
// Review the recipient, quote and optional memo together.
const p = await wallet.prepareReviewedPrivateSend({quoteId: quote.quoteId, memo});
const sent = await wallet.executePrivateSend({preparedId: p.preparedId});
const state = await wallet.reconcilePrivateSend({preparedId: sent.preparedId});
```

Use the root address helpers; memo maximum is 80 UTF-8 bytes. A recipient identity binds the network, generation, pool and asset. Cancel only unsigned prepared work using cancelPrivateSend, then reconcile.

## Public and enhanced withdrawals

```js
const quote = await wallet.quoteWithdrawal({amountAtomic, destination, enhanced, partnerHandle});
// Show payout, reserve, all fees, total debit, expiry and enhanced window.
const p = await wallet.prepareReviewedWithdrawal({quoteId: quote.quoteId});
const sent = await wallet.authorizeWithdrawal({intentId: p.intentId, enhanced});
const transactionId = enhanced ? sent.transactionId : (sent.preparedId ?? p.intentId);
const state = await wallet.monitorWithdrawal({transactionId, enhanced});
```

Use enhanced:false for regular withdrawals and enhanced:true for three-installment enhanced withdrawals. The regular authorization and monitor return a normal review (preparedId and phase), whereas enhanced authorization returns transactionId and status. Preserve the distinction. Do not mark enhanced complete at authorization. Display completed/total and each claim's canonical state; getEnhancedHost().recover({transactionId}) is the local recovery path when appropriate. Only cancel an unsigned enhanced review with getEnhancedHost().cancel({intentId}).

## Public batch

```js
const quote = await wallet.quotePublicBatch({payments, partnerHandle});
// payments = [{recipient: '0x...', amountAtomic: '...'}, ...]
// Review every recipient and gross/net totals, fees and reserve.
const p = await wallet.prepareReviewedPublicBatch({quoteId: quote.quoteId});
const sent = await wallet.authorizePublicBatch({intentId: p.intentId});
const state = await wallet.monitorPublicBatch({transactionId: sent.transactionId});
```

This is a public payout batch, not a batch of private transfers.

## Swap and bridge

```js
const operation = 4; // 5 for bridge
const venue = await wallet.quoteRoute({operation, amountAtomic, slippageBps, receiver});
const quote = await wallet.quoteRouteFees({
  operation, amountAtomic, receiver, slippageBps, partnerHandle,
  minimumOutputAtomic: venue.minimumOutputAtomic,
  maximumDeliveryFeeAtomic: venue.maximumDeliveryFeeAtomic,
});
// Review the bound fee quote and venue output/minimum/delivery fee.
const p = await wallet.prepareReviewedRoute({operation, quoteId: quote.quoteId});
const sent = await wallet.executeRoute({operation, preparedId: p.preparedId});
const state = await wallet.reconcileRoute({operation, preparedId: sent.preparedId});
```

Use receiver and slippage supported by the enabled venue and route. Venue output decimals are not necessarily input asset decimals. Requote if venue conditions change; don't silently modify bound fields. A private-output swap may still need output reconciliation; CCIP source inclusion is not destination delivery. Use listRoutes(operation), reconcileRoute and cancelRoute only for unsigned prepared work.

## Public wallet payment link

```js
import {openStealthOSPublicPayment} from '@stealthos/vanta-sdk';
const client = await openStealthOSPublicPayment({configuration, provider, recipient: encodedPrivateRecipient, workerUrl});
try {
  const q = await client.quotePayment({amountAtomic});
  // Display the encoded recipient, net credit, fee and public wallet gas.
  const p = await client.prepareReviewedPayment({quoteId: q.quoteId});
  const sent = await client.executePayment({preparedId: p.preparedId});
  const state = await client.reconcilePayment({preparedId: sent.preparedId, transactionHash: sent.transactionHash});
} finally { client.dispose(); }
```

The payer does not need a private recovery phrase. Reopen the same payment context to recover pending payments.

## Lifecycle and readback

Deposit/payment phases: prepared, broadcast-uncertain, finalized, expired-unused, failed (with failure detail where available). Private-send and routed phases include proving, prepared, submitting, included, finalized, failed-finalized, failed, expired-unused, cancelled. For routed operations also inspect output/delivery evidence, not just source phase. Regular withdrawal monitoring returns a normal review with phase; listWithdrawals maps its history into authorized, authorizationFailed, finalized and transactionHash. Public batch monitoring returns these status booleans. Enhanced exposes completed, total, progress, authorizationFailed, recoveryRequired, and claims waiting/prepared/submitted/included/finalized/recovery. Completion is operation-specific.

Recover via listPendingDeposits/listDepositHistory, listPrivateSends, listWithdrawals (batch records have batch:true), listRoutes(4 or 5), or listPendingPayments. Use historyAsset where supported to read the original asset context. Preserve original IDs, monitor/reconcile rather than reauthorize, and display ambiguous states as uncertain. See [ERROR_HANDLING.md](ERROR_HANDLING.md).
