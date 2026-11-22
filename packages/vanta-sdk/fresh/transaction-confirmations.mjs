/** SDK operational settlement, on every EVM network. This is deliberately
 * confirmation-based: it does not assert consensus finality or alter a bridge's
 * verification policy. The mined block counts as the first confirmation.
 * Canonical receipts, chain/genesis pins and contract checks remain mandatory.
 */
export const SDK_TRANSACTION_CONFIRMATIONS = 2;
export const SDK_SETTLEMENT_POLICY = Object.freeze({
  mode: 'confirmations', confirmations: SDK_TRANSACTION_CONFIRMATIONS,
  consensusFinality: false,
});
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/iu.test(value);
const valid = block => Number.isSafeInteger(block?.number) && block.number >= 0 && hash(block.hash);
export async function getConfirmedBlock(provider) {
  if (typeof provider?.getBlock !== 'function') throw Error('A canonical block provider is required.');
  const head = await provider.getBlock('latest');
  if (!valid(head) || head.number < SDK_TRANSACTION_CONFIRMATIONS)
    throw Error('Confirmed chain head is unavailable.');
  const height = head.number - SDK_TRANSACTION_CONFIRMATIONS + 1;
  const block = await provider.getBlock(height);
  if (!valid(block) || block.number !== height ||
      (head.parentHash != null && head.parentHash.toLowerCase() !== block.hash.toLowerCase()))
    throw Error('Canonical chain changed while checking confirmations; retry reconciliation.');
  return Object.freeze({...block, settlement: SDK_SETTLEMENT_POLICY});
}
export async function getSharedConfirmedBlock(provider, verificationProvider) {
  const heads = await Promise.all([getConfirmedBlock(provider), getConfirmedBlock(verificationProvider)]);
  const height = Math.min(...heads.map(block => block.number));
  const blocks = await Promise.all([provider.getBlock(height), verificationProvider.getBlock(height)]);
  if (blocks.some(block => !valid(block) || block.number !== height) ||
      blocks[0].hash.toLowerCase() !== blocks[1].hash.toLowerCase())
    throw Error('Canonical confirmation anchors disagree.');
  return Object.freeze({...blocks[0], settlement: SDK_SETTLEMENT_POLICY});
}
