export type VantaAllowedToken = Readonly<{
    chainId: number;
    id: string;
    kind: "native" | "erc20";
    symbol: string;
    tokenAddress: string;
    decimals: number;
}>;
export declare const VANTA_TOKEN_ALLOWLIST_VERSION: 1;
/** Listed networks are supported by this allowlist, not every network in a host app. */
export declare function getVantaSupportedNetworkIds(): readonly number[];
export declare function getVantaAllowedTokens(chainId: number | bigint): readonly VantaAllowedToken[];
/** Match chain and address bytes. Symbols and caller-provided token metadata grant nothing. */
export declare function requireVantaAllowedToken(chainId: number | bigint, tokenAddress: string): VantaAllowedToken;
export declare function isVantaTokenAllowed(chainId: number | bigint, tokenAddress: string): boolean;
//# sourceMappingURL=token-allowlist.d.ts.map