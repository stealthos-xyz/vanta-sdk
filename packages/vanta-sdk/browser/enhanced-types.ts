/** Local wallet-facing extension. The SDK implementation must provide
 * CAS-fenced, durable note cancellation before this surface is qualified. */
import type {EnhancedWithdrawalHost as SdkEnhancedWithdrawalHost}
  from "@stealthos/vanta-sdk/enhanced-host";

export type {
  EnhancedWithdrawalHostContext,
  EnhancedWithdrawalAvailability,
  EnhancedWithdrawalReview,
  EnhancedWithdrawalClaimState,
  EnhancedWithdrawalStatus,
} from "@stealthos/vanta-sdk/enhanced-host";

export type EnhancedWithdrawalHost = SdkEnhancedWithdrawalHost & Readonly<{
  cancel(input: Readonly<{intentId: string}>): Promise<Readonly<{cancelled: true}>>;
}>;
