import { type VantaAllowedToken } from "./token-allowlist.js";
export type VantaTokenPolicy = Readonly<{
    schema: "stealthos-vanta-token-policy-v1";
    version: 1;
    policyHash: string;
    expiresAt: number;
    networks: readonly Readonly<{
        chainId: number;
        tokens: readonly VantaAllowedToken[];
    }>[];
}>;
export type VantaTokenPolicyConnection = Readonly<{
    relayerUrl: string;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
}>;
/** Read the operator's CURRENT enabled subset. No stale bundled fallback. */
export declare function fetchVantaTokenPolicy(input: VantaTokenPolicyConnection): Promise<VantaTokenPolicy>;
/** Use immediately before transaction preparation/signing, with no cached override. */
export declare function requireVantaEnabledToken(input: VantaTokenPolicyConnection & {
    chainId: number | bigint;
    tokenAddress: string;
}): Promise<VantaAllowedToken>;
//# sourceMappingURL=token-policy.d.ts.map