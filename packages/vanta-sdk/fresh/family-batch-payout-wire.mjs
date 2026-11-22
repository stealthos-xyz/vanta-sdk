import {AbiCoder, Interface, ZeroAddress, getAddress, getCreate2Address, id, keccak256} from 'ethers';
import {FAMILY_NORMAL_QUOTE, familyNormalProofType, familyNormalAbi, familyNormalDigest} from './family-normal-wire.mjs';
import {compiledFamilyBatchPayout} from './family-batch-payout-deployment.mjs';

const coder = AbiCoder.defaultAbiCoder();
const batchType = '(address[] recipients,uint128[] amounts)';
const domain = id('STEALTHOS_FAMILY_BATCH_PAYOUT_V1');
const max = (1n << 120n) - 1n;
const address = value => getAddress(value).toLowerCase();
const fail = () => { throw Error('Batch payout, quote or deployment binding differs.'); };

export const familyBatchPayoutAbi = new Interface([
  ...[8, 32].map(width => `function execute${width}(${FAMILY_NORMAL_QUOTE},${familyNormalProofType(width)},bytes,${batchType})`),
  `function predictEscrow(address pool,address asset,bytes32 nonce,${batchType}) view returns(address)`,
  'function poolCodeHash(address pool) view returns(bytes32)',
  'function escrowImplementation() view returns(address)',
  'event BatchPaid(bytes32 indexed quoteNonce,bytes32 indexed batchHash,address indexed pool,uint128 total)',
]);

export function normalizeFamilyBatchPayout(batch) {
  if (!batch || !Array.isArray(batch.recipients) || !Array.isArray(batch.amounts) ||
      batch.recipients.length < 2 || batch.recipients.length > 32 || batch.amounts.length !== batch.recipients.length) fail();
  const recipients = Array.from(batch.recipients, address);
  const amounts = Array.from(batch.amounts, value => {
    if (typeof value !== 'string' && typeof value !== 'bigint') fail();
    if (!/^[1-9][0-9]{0,36}$/u.test(String(value)) || BigInt(value) > max) fail();
    return String(value);
  });
  const total = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  if (recipients.includes(ZeroAddress) || total > max) fail();
  return {recipients, amounts, total};
}

export function familyBatchPayoutScope(release, deployment) {
  if(!deployment){
    const gateway=release.lock?.contracts?.find(p=>p.name==='batch-payout-gateway'),escrow=release.lock?.contracts?.find(p=>p.name==='batch-payout-escrow');
    deployment=gateway&&escrow?{...release.pins,familyTag:release.setup.family.tag,gateway:address(gateway.address),gatewayCodehash:gateway.codehash,
      escrowImplementation:address(escrow.address),escrowCodehash:escrow.codehash}:compiledFamilyBatchPayout;
  }
  if (!deployment || deployment.networkId !== release.pins.networkId ||
      deployment.genesisHash !== release.pins.genesisHash || deployment.generationId !== release.pins.generationId ||
      deployment.setupId !== release.pins.setupId || deployment.familyTag !== release.setup.family.tag) fail();
  if (address(deployment.gateway) === ZeroAddress || address(deployment.escrowImplementation) === ZeroAddress ||
      ![deployment.gatewayCodehash, deployment.escrowCodehash].every(value => /^0x[0-9a-f]{64}$/u.test(value))) fail();
  return deployment;
}

export async function verifyFamilyBatchPayout(provider, deployment, pool, poolCodehash, blockTag) {
  const {gateway, escrowImplementation} = deployment;
  const [gatewayCode, escrowCode, pinnedPool] = await Promise.all([
    provider.getCode(gateway, blockTag),
    provider.getCode(escrowImplementation, blockTag),
    provider.call({to: gateway, data: familyBatchPayoutAbi.encodeFunctionData('poolCodeHash', [pool]), blockTag}),
  ]);
  if (keccak256(gatewayCode) !== deployment.gatewayCodehash || keccak256(escrowCode) !== deployment.escrowCodehash ||
      familyBatchPayoutAbi.decodeFunctionResult('poolCodeHash', pinnedPool)[0] !== poolCodehash) fail();
}

export function familyBatchPayoutHash(deployment, quote, batch) {
  const {recipients, amounts} = normalizeFamilyBatchPayout(batch);
  return keccak256(coder.encode(
    ['bytes32', 'uint256', 'address', 'address', 'address', 'bytes32', batchType],
    [domain, quote.chainId, deployment.gateway, quote.pool, quote.asset, quote.nonce, [recipients, amounts]],
  ));
}

export function familyBatchEscrowAddress(deployment, quote, batch) {
  const code = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73' +
    address(deployment.escrowImplementation).slice(2) + '5af43d82803e903d91602b57fd5bf3';
  return getCreate2Address(deployment.gateway, familyBatchPayoutHash(deployment, quote, batch), keccak256(code)).toLowerCase();
}

export function validateFamilyBatchPayout(deployment, quote, batch) {
  const normalized = normalizeFamilyBatchPayout(batch);
  const escrow = familyBatchEscrowAddress(deployment, quote, normalized);
  if (Number(quote.mode) !== 0 || quote.relayer.toLowerCase() !== deployment.gateway ||
      quote.recipient.toLowerCase() !== escrow || normalized.total !== BigInt(quote.payout) ||
      normalized.recipients.some(recipient => [escrow, deployment.gateway, quote.pool.toLowerCase()].includes(recipient))) fail();
  return normalized;
}

export function encodeFamilyBatchPayout(deployment, quote, batch, poolCalldata) {
  const {recipients, amounts} = validateFamilyBatchPayout(deployment, quote, batch);
  const call = familyNormalAbi.parseTransaction({data: poolCalldata});
  if (call?.name !== 'settleNormalEpoch' + quote.width || familyNormalDigest(call.args[0]) !== familyNormalDigest(quote)) fail();
  return familyBatchPayoutAbi.encodeFunctionData('execute' + quote.width, [...call.args, [recipients, amounts]]);
}

export function decodeFamilyBatchPayout(deployment, quote, batch, calldata) {
  const expected = validateFamilyBatchPayout(deployment, quote, batch);
  const call = familyBatchPayoutAbi.parseTransaction({data: calldata});
  if (call?.name !== 'execute' + quote.width ||
      familyBatchPayoutAbi.encodeFunctionData(call.fragment, call.args) !== calldata ||
      familyNormalDigest(call.args[0]) !== familyNormalDigest(quote)) fail();
  const actual = normalizeFamilyBatchPayout(call.args[3]);
  if (JSON.stringify([actual.recipients, actual.amounts]) !== JSON.stringify([expected.recipients, expected.amounts])) fail();
  return call;
}
