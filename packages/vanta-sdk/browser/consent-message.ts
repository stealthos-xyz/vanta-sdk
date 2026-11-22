/** Canonical EIP-191 message bound to the relayer's exact calldata hash.
 * This pure builder neither chooses a release nor requests wallet signatures. */
import {getAddress, keccak256} from "ethers";

const WORD = /^0x[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9:_-]{8,128}$/u;
const BYTES = /^0x(?:[0-9a-f]{2})+$/u;
function fail():never {throw Error("Enhanced consent does not match the compiled family release.");}

export type EnhancedConsentContext = Readonly<{
  networkId: string;
  generationId: string;
  pool: string;
  assetAddress: string;
}>;
export type EnhancedConsentRequest = Readonly<{
  intentId: string;
  requestId: string;
  pool: string;
  asset: string;
  calldata: string;
}>;
export type EnhancedConsentRelease = Readonly<{
  setup: {family: {id: string; tag: string}};
  activation: {familyTag: string; network: {id: string; genesisHash: string}};
  pins: {networkId: string; genesisHash: string; generationId: string};
  lock: {familyTag: string; contracts: ReadonlyArray<{kind: string; address: string}>};
}>;

/** The relayer independently reconstructs these eight exact fields. */
export function buildEnhancedConsentMessage(
  release: EnhancedConsentRelease, context: EnhancedConsentContext,
  request: EnhancedConsentRequest, approvedIntentId: string,
): string {
  if (!release || !context || !request ||
      Object.keys(request).sort().join() !== "asset,calldata,intentId,pool,requestId" ||
      !ID.test(request.requestId) || !ID.test(request.intentId) ||
      request.intentId !== approvedIntentId ||
      !release.setup?.family?.id ||
      !/^eip155:[1-9][0-9]*$/u.test(release.pins.networkId) ||
      release.activation.network.id !== release.pins.networkId ||
      context.networkId !== release.pins.networkId ||
      !WORD.test(release.setup.family.tag) || BigInt(release.setup.family.tag) === 0n ||
      release.setup.family.tag !== release.activation.familyTag ||
      release.setup.family.tag !== release.lock.familyTag ||
      !WORD.test(release.pins.genesisHash) || BigInt(release.pins.genesisHash) === 0n ||
      release.activation.network.genesisHash !== release.pins.genesisHash ||
      !WORD.test(release.pins.generationId) || BigInt(release.pins.generationId) === 0n ||
      release.pins.generationId !== context.generationId ||
      !BYTES.test(request.calldata) || request.calldata.length > 512 * 1024) fail();
  let pool: string, asset: string;
  try {
    pool = getAddress(request.pool).toLowerCase();
    asset = getAddress(request.asset).toLowerCase();
    if (pool !== getAddress(context.pool).toLowerCase() ||
        asset !== getAddress(context.assetAddress).toLowerCase() ||
        !release.lock.contracts.some(contract =>
          contract.kind === "pool" && getAddress(contract.address).toLowerCase() === pool)) fail();
  } catch {fail();}
  return "Vanta private settlement authorization v1\n" + JSON.stringify([
    release.setup.family.tag, Number(release.pins.networkId.split(':')[1]), release.pins.genesisHash, release.pins.generationId,
    pool, asset, request.requestId, keccak256(request.calldata),
  ]);
}
