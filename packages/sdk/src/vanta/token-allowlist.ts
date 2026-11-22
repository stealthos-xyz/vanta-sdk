/** Operator-reviewed assets. Pool/codehash verification is also required. */
import { getAddress } from "ethers";
import { VANTA_TOKEN_ALLOWLIST_DATA } from "./token-allowlist-data.js";

export type VantaAllowedToken = Readonly<{
  chainId: number;
  id: string;
  kind: "native" | "erc20";
  symbol: string;
  tokenAddress: string;
  decimals: number;
}>;

export const VANTA_TOKEN_ALLOWLIST_VERSION = VANTA_TOKEN_ALLOWLIST_DATA.version;
const tokens: readonly VantaAllowedToken[] = Object.freeze(
  VANTA_TOKEN_ALLOWLIST_DATA.networks.flatMap(network => network.tokens.map(token =>
    Object.freeze({ ...token, chainId: network.chainId,
      tokenAddress: getAddress(token.tokenAddress) }))),
);
const networks: readonly number[] = Object.freeze([...new Set(tokens.map(t => t.chainId))]);
const none: readonly VantaAllowedToken[] = Object.freeze([]);

function networkNumber(value: number | bigint): number | null {
  if (typeof value === "bigint") {
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Listed networks are supported by this allowlist, not every network in a host app. */
export function getVantaSupportedNetworkIds(): readonly number[] {
  return networks;
}

export function getVantaAllowedTokens(chainId: number | bigint): readonly VantaAllowedToken[] {
  const chain = networkNumber(chainId);
  return chain === null ? none : Object.freeze(tokens.filter(t => t.chainId === chain));
}

/** Match chain and address bytes. Symbols and caller-provided token metadata grant nothing. */
export function requireVantaAllowedToken(chainId: number | bigint, tokenAddress: string): VantaAllowedToken {
  let address: string;
  try { address = getAddress(tokenAddress); }
  catch { throw Error("Vanta token is not allowed on this network."); }
  const token = getVantaAllowedTokens(chainId).find(t => t.tokenAddress === address);
  if (!token) throw Error("Vanta token is not allowed on this network.");
  return token;
}

export function isVantaTokenAllowed(chainId: number | bigint, tokenAddress: string): boolean {
  try { requireVantaAllowedToken(chainId, tokenAddress); return true; }
  catch { return false; }
}
