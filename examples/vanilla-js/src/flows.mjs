// Quote-first reference flows. The caller must render display locally and obtain
// explicit consent before invoking submit. Never replay submit after an error.
export function positiveAtomic(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,35}$/.test(value) || BigInt(value) >= 2n ** 120n) {
    throw new Error('Enter a positive integer amount in atomic units.');
  }
  return value;
}

export function toAtomic(value, decimals) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Too many decimal places.');
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')).toString();
}

const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' required.');
  return value.trim();
};
const address = value => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new Error('Enter a valid nonzero public address.');
  return value;
};

export async function createReview(client, input) {
  const kind = input.kind;
  const partnerHandle = input.partnerHandle;
  const amountAtomic = kind === 'batch' ? undefined : positiveAtomic(input.amountAtomic);
  let quote, details, execute;
  switch (kind) {
    case 'deposit':
      quote = await client.quoteDeposit({amountAtomic, partnerHandle});
      execute = async () => {
        const p = await client.prepareReviewedDeposit({quoteId: quote.quoteId});
        const s = await client.executeDeposit({preparedId: p.preparedId});
        return client.reconcileDeposit({preparedId: p.preparedId, transactionHash: s.transactionHash});
      };
      break;
    case 'payment':
      quote = await client.quotePayment({amountAtomic});
      details = {recipient: client.recipient};
      execute = async () => {
        const p = await client.prepareReviewedPayment({quoteId: quote.quoteId});
        const s = await client.executePayment({preparedId: p.preparedId});
        return client.reconcilePayment({preparedId: p.preparedId, transactionHash: s.transactionHash});
      };
      break;
    case 'private': {
      const recipient = input.recipient;
      if (!recipient || typeof recipient !== 'object') throw new Error('Resolve the private recipient first.');
      const memo = input.memo || undefined;
      quote = await client.quotePrivateSend({recipient, amountAtomic, partnerHandle});
      details = {recipient, memo};
      execute = async () => {
        const p = await client.prepareReviewedPrivateSend({quoteId: quote.quoteId, ...(memo ? {memo} : {})});
        const s = await client.executePrivateSend({preparedId: p.preparedId});
        return client.reconcilePrivateSend({preparedId: s.preparedId});
      };
      break;
    }
    case 'withdrawal':
    case 'enhanced': {
      const enhanced = kind === 'enhanced';
      const destination = address(input.destination);
      quote = await client.quoteWithdrawal({amountAtomic, destination, enhanced, partnerHandle});
      execute = async () => {
        const p = await client.prepareReviewedWithdrawal({quoteId: quote.quoteId});
        if (p.enhanced !== enhanced) throw new Error('Withdrawal mode changed.');
        const s = await client.authorizeWithdrawal({intentId: p.intentId, enhanced});
        const transactionId = enhanced ? s.transactionId : (s.preparedId ?? p.intentId);
        return client.monitorWithdrawal({transactionId: required(transactionId, 'Transaction ID'), enhanced});
      };
      break;
    }
    case 'batch': {
      if (!Array.isArray(input.payments) || !input.payments.length) throw new Error('Enter a nonempty payment array.');
      const payments = input.payments.map(p => ({recipient: address(p.recipient), amountAtomic: positiveAtomic(p.amountAtomic)}));
      quote = await client.quotePublicBatch({payments, partnerHandle});
      details = {payments};
      execute = async () => {
        const p = await client.prepareReviewedPublicBatch({quoteId: quote.quoteId});
        const s = await client.authorizePublicBatch({intentId: p.intentId});
        return client.monitorPublicBatch({transactionId: required(s.transactionId, 'Transaction ID')});
      };
      break;
    }
    case 'swap':
    case 'bridge': {
      const operation = kind === 'swap' ? 4 : 5;
      const receiver = required(input.destination, 'Route receiver');
      const slippageBps = input.slippageBps;
      if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) throw new Error('Slippage must be 1 to 5000 basis points.');
      const venue = await client.quoteRoute({operation, amountAtomic, slippageBps, receiver});
      quote = await client.quoteRouteFees({
        operation, amountAtomic, receiver, slippageBps, partnerHandle,
        minimumOutputAtomic: venue.minimumOutputAtomic,
        maximumDeliveryFeeAtomic: venue.maximumDeliveryFeeAtomic,
      });
      details = {receiver, venue, slippageBps};
      execute = async () => {
        const p = await client.prepareReviewedRoute({operation, quoteId: quote.quoteId});
        const s = await client.executeRoute({operation, preparedId: p.preparedId});
        return client.reconcileRoute({operation, preparedId: s.preparedId});
      };
      break;
    }
    default: throw new Error('Unsupported operation.');
  }
  const expiry = quote.deadline ?? quote.expiresAt;
  if (!Number.isFinite(expiry) || expiry <= Date.now() / 1000) throw new Error('Quote is expired.');
  let attempted = false;
  return Object.freeze({
    display: {operation: kind, ...details, quote, expiry},
    async submit(approved) {
      if (approved !== true || attempted) throw new Error('Explicit approval of a fresh quote is required.');
      if (Date.now() / 1000 >= expiry) throw new Error('Quote expired; request a new review.');
      attempted = true;
      return execute();
    },
  });
}

export async function readHistory(client, kind) {
  switch (kind) {
    case 'payment': return client.listPendingPayments();
    case 'deposit': return client.listDepositHistory();
    case 'private': return client.listPrivateSends();
    case 'withdrawal':
    case 'enhanced':
    case 'batch': return (await client.listWithdrawals()).filter(row =>
      kind === 'enhanced' ? row.enhanced : kind === 'batch' ? row.batch : !row.enhanced && !row.batch);
    case 'swap': return client.listRoutes(4);
    case 'bridge': return client.listRoutes(5);
    default: throw new Error('Unsupported operation.');
  }
}

export async function reconcile(client, kind, id) {
  const original = required(id, 'Original journal ID');
  switch (kind) {
    case 'payment': return client.reconcilePayment({preparedId: original});
    case 'deposit': return client.reconcileDeposit({preparedId: original});
    case 'private': return client.reconcilePrivateSend({preparedId: original});
    case 'withdrawal':
    case 'enhanced': return client.monitorWithdrawal({transactionId: original, enhanced: kind === 'enhanced'});
    case 'batch': return client.monitorPublicBatch({transactionId: original});
    case 'swap':
    case 'bridge': return client.reconcileRoute({operation: kind === 'swap' ? 4 : 5, preparedId: original});
    default: throw new Error('Unsupported operation.');
  }
}
