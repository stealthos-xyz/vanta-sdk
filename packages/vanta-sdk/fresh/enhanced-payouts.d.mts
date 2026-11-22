export interface EnhancedPayoutScheduleInput {
  /** Exact net amount paid publicly, in atomic asset units. */
  readonly netPayoutAtomic: string;
  readonly dustAtomic?: string;
  readonly nowSeconds?: number;
  /** Default 360 one-minute epochs. */
  readonly windowEpochs?: number;
  /** Default five epochs; must allow a positive initial delay. */
  readonly minimumDelayEpochs?: number;
}
export interface EnhancedPayoutSchedulePolicy {
  /** Maximum window from the trusted contract policy, when available. */
  readonly maximumWindowEpochs?: number;
}
export interface EnhancedPrivateClaimSchedule {
  readonly slot: number;
  readonly amountAtomic: string;
  readonly releaseEpoch: number;
  readonly windowEndEpoch: number;
}
export interface EnhancedPrivatePayoutSchedule {
  readonly schema: "vanta-enhanced-private-schedule-v1";
  readonly authorizationEpoch: number;
  readonly netPayoutAtomic: string;
  readonly dustAtomic: string;
  readonly windowEpochs: number;
  readonly minimumDelayEpochs: number;
  readonly claims: readonly EnhancedPrivateClaimSchedule[];
}
export function createEnhancedPayoutSchedule(input: EnhancedPayoutScheduleInput,
  policy?: EnhancedPayoutSchedulePolicy): EnhancedPrivatePayoutSchedule;

export interface EnhancedPayoutContext {
  readonly networkId: string;
  readonly generationId: string;
  readonly pool: string;
  readonly assetAddress: string;
}
export interface EnhancedExpectedClaim {
  readonly nullifier: string;
  readonly recipient: string;
  readonly amountAtomic: string;
}
/** Evidence must be verified against the pinned contract by the trusted host.
 * These fields alone are not proof of a real blockchain payment.
 */
export interface VerifiedEnhancedClaimReceipt extends EnhancedPayoutContext {
  readonly nullifier: string;
  readonly recipient: string;
  readonly amountAtomic: string;
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly canonicalBlockHash: string;
  readonly finalizedBlockNumber: number;
}
export type EnhancedClaimObservation =
  | Readonly<{ nullifier: string; state: "pending" | "recovery-required" }>
  | Readonly<{ nullifier: string; state: "submitted"; transactionHash: string }>
  | Readonly<{ nullifier: string; state: "included" | "finalized"; receipt: VerifiedEnhancedClaimReceipt }>;
export interface EnhancedClaimStatus {
  readonly number: number;
  readonly state: "pending" | "submitted" | "included" | "finalized" | "reorged" | "recovery-required";
  readonly transactionHash: string | null;
}
export interface EnhancedPayoutStatus {
  readonly completed: number;
  readonly total: 3;
  readonly progress: string;
  readonly settled: boolean;
  readonly recoveryRequired: boolean;
  readonly claims: readonly EnhancedClaimStatus[];
}
export function projectVerifiedEnhancedPayoutStatus(input: Readonly<{
  context: EnhancedPayoutContext;
  claims: readonly EnhancedExpectedClaim[];
  observations: readonly EnhancedClaimObservation[];
}>): EnhancedPayoutStatus;

export type { EnhancedWithdrawalHost, EnhancedWithdrawalHostContext, EnhancedWithdrawalAvailability,
  EnhancedWithdrawalReview, EnhancedWithdrawalStatus, EnhancedWithdrawalClaimState } from "./enhanced-host.mjs";
