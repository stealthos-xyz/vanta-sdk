export function matchesFamilyDepositApproval(review: unknown, actual: unknown, context: {
  wallet: string; pool: string; generationId: string; nowSeconds: number;
}): boolean;
export function matchesReviewedDepositPolicy(
  quote: {deadline:number; partnerId:unknown; policyVersion:string; receiverCommitment:string; authorizationKey:string; partnerFeeAtomic:string},
  membership: {partnerId:unknown; version:bigint; receiverCommitment:bigint; authorizationKey:bigint}, fee:bigint, nowSeconds:number,
): boolean;
