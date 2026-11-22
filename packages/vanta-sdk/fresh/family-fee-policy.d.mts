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
