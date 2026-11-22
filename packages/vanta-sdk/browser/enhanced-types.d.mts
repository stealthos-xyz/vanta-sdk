/** Local wallet-facing extension. The SDK implementation must provide
 * CAS-fenced, durable note cancellation before this surface is qualified. */
import type {EnhancedWithdrawalHost as SdkEnhancedWithdrawalHost}
  from "../fresh/enhanced-host.mjs";

export type {
  EnhancedWithdrawalHostContext,
  EnhancedWithdrawalAvailability,
  EnhancedWithdrawalReview,
  EnhancedWithdrawalClaimState,
  EnhancedWithdrawalStatus,
} from "../fresh/enhanced-host.mjs";

export type EnhancedWithdrawalHost = SdkEnhancedWithdrawalHost & Readonly<{
  cancel(input: Readonly<{intentId: string}>): Promise<Readonly<{cancelled: true}>>;
}>;
