import { getAddress } from "ethers";
import { getVantaAllowedTokens, requireVantaAllowedToken, type VantaAllowedToken } from "./token-allowlist.js";

export type VantaTokenPolicy = Readonly<{
  schema: "stealthos-vanta-token-policy-v1";
  version: 1;
  policyHash: string;
  expiresAt: number;
  networks: readonly Readonly<{ chainId: number; tokens: readonly VantaAllowedToken[] }>[];
}>;
export type VantaTokenPolicyConnection = Readonly<{
  relayerUrl: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}>;

/** Read the operator's CURRENT enabled subset. No stale bundled fallback. */
export async function fetchVantaTokenPolicy(input: VantaTokenPolicyConnection): Promise<VantaTokenPolicy> {
  const endpoint = new URL("/api/v1/relay/vanta-v8/token-policy", input.relayerUrl);
  if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && endpoint.hostname === "localhost")) ||
      endpoint.username || endpoint.password)
    throw Error("Vanta token policy requires a secure relayer endpoint.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (input.signal?.aborted) abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10_000);
  const options = {
    method: "GET", cache: "no-store", redirect: "error", credentials: "omit",
    signal: controller.signal,
  } as const;
  let body: { success?: unknown; policy?: VantaTokenPolicy };
  try {
    const response = await (input.fetcher ?? fetch)(endpoint, options);
    if (!response.ok) throw Error("Vanta token policy is unavailable; retry before transacting.");
    body = await response.json() as { success?: unknown; policy?: VantaTokenPolicy };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
  const p = body?.policy, now = Math.floor(Date.now() / 1000);
  if (body?.success !== true || !p || p.schema !== "stealthos-vanta-token-policy-v1" ||
      p.version !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(p.policyHash) ||
      !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now || p.expiresAt > now + 60 ||
      !Array.isArray(p.networks) || p.networks.length > 32)
    throw Error("Invalid or expired Vanta token policy.");
  const seenChains = new Set<number>();
  const networks = p.networks.map(network => {
    if (!network || !Number.isSafeInteger(network.chainId) || network.chainId <= 0 ||
        seenChains.has(network.chainId) || !Array.isArray(network.tokens) || network.tokens.length > 256)
      throw Error("Invalid Vanta token policy network.");
    seenChains.add(network.chainId);
    const seenTokens = new Set<string>();
    const tokens = network.tokens.map((token: VantaAllowedToken) => {
      const known = getVantaAllowedTokens(network.chainId).find(item =>
        item.tokenAddress === getAddress(token.tokenAddress));
      if (!known || token.chainId !== network.chainId || token.id !== known.id ||
          token.kind !== known.kind || token.symbol !== known.symbol || token.decimals !== known.decimals ||
          seenTokens.has(known.tokenAddress))
        throw Error("Vanta token policy contains unsupported or mismatched assets.");
      seenTokens.add(known.tokenAddress);
      return known;
    });
    return Object.freeze({ chainId: network.chainId, tokens: Object.freeze(tokens) });
  });
  return Object.freeze({ schema: p.schema, version: p.version, policyHash: p.policyHash,
    expiresAt: p.expiresAt, networks: Object.freeze(networks) });
}

/** Use immediately before transaction preparation/signing, with no cached override. */
export async function requireVantaEnabledToken(input: VantaTokenPolicyConnection & {
  chainId: number | bigint; tokenAddress: string;
}): Promise<VantaAllowedToken> {
  const known = requireVantaAllowedToken(input.chainId, input.tokenAddress);
  const policy = await fetchVantaTokenPolicy(input);
  if (!policy.networks.find(network => network.chainId === known.chainId)?.tokens
      .some(token => token.tokenAddress === known.tokenAddress))
    throw Error("Vanta token is disabled by the current protocol policy.");
  return known;
}
