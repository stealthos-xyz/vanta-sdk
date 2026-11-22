export interface FamilyProtocolFeePolicy {
 readonly address: string; readonly administrator: string; readonly revision: string;
 readonly rates: readonly (number|null)[]; readonly policyHash: string; readonly basePolicyHash: string;
 readonly withdrawalOnly?: true;
 readonly blockNumber: number; readonly blockHash: string;
}
export interface FamilyProtocolFeeOptions {
 provider: any; verificationProvider: any; pool: string; blockTag?: string | number;
 releaseContext?: import('./family-network.mjs').FamilyReleaseContext;
}
export function readVantaFamilyProtocolFees(options: FamilyProtocolFeeOptions): Promise<FamilyProtocolFeePolicy>;
export function prepareVantaFamilyProtocolFeeUpdate(options: FamilyProtocolFeeOptions & {rates: number[]}): Promise<{
 readonly policy: FamilyProtocolFeePolicy; readonly rates: readonly number[];
 readonly transaction: Readonly<{chainId: string; from: string; to: string; value: string; data: string}>;
}>;
