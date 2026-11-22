/** Restricted EOA signer for one already-reviewed family funding intent.
 * The worker never supplies an arbitrary message, signer, RPC, or release. */
import {getAddress, hexlify, toUtf8Bytes, verifyMessage} from "ethers";
import {getCompiledFamilyEvmRelease} from "@stealthos/vanta-sdk/family-network";
import {buildEnhancedConsentMessage} from "./consent-message";
import type {EnhancedConsentContext, EnhancedConsentRequest} from "./consent-message";
import type {SelectedFamilyWalletProvider} from "./app-wallet";

const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const fail = (): never => {throw Error("Wallet authorization is unavailable for this reviewed intent.");};

export async function signCompiledEnhancedConsent({
  provider, wallet, intentId, request, context, assertCurrent,
}: Readonly<{
  provider: SelectedFamilyWalletProvider;
  wallet: string;
  intentId: string;
  request: EnhancedConsentRequest;
  context: EnhancedConsentContext;
  assertCurrent(): Promise<void>;
}>): Promise<Readonly<{signature: string}>> {
  await assertCurrent();
  const release = getCompiledFamilyEvmRelease(); // NO caller-supplied release override
  const message = buildEnhancedConsentMessage(release, context, request, intentId);
  const expected = getAddress(wallet).toLowerCase();
  const [accounts, chainId] = await Promise.all([
    provider.request({method: "eth_accounts"}), provider.request({method: "eth_chainId"}),
  ]);
  if (!Array.isArray(accounts) || accounts.length === 0 ||
      getAddress(String(accounts[0])).toLowerCase() !== expected ||
      BigInt(chainId as string) !== BigInt(release.pins.networkId.split(':')[1])) fail();
  await assertCurrent();
  // One request for the exact relayer-domain EIP-191 byte string.
  const signed = await provider.request({
    method: "personal_sign", params: [hexlify(toUtf8Bytes(message)), expected],
  });
  const signature = typeof signed === "string" ? signed.toLowerCase() : "";
  if (!SIGNATURE.test(signature)) fail();
  if (verifyMessage(message, signature).toLowerCase() !== expected) fail();
  const [afterAccounts, afterChain] = await Promise.all([
    provider.request({method: "eth_accounts"}), provider.request({method: "eth_chainId"}),
  ]);
  if (!Array.isArray(afterAccounts) || afterAccounts.length === 0 ||
      getAddress(String(afterAccounts[0])).toLowerCase() !== expected ||
      BigInt(afterChain as string) !== BigInt(release.pins.networkId.split(':')[1])) fail();
  await assertCurrent();
  return Object.freeze({signature});
}
