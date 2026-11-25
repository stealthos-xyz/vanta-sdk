export const DEPOSIT_STAGES: readonly string[];
export interface DepositFailure {readonly code: string; readonly cause: string; readonly stage: string}
export const DEPOSIT_INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS';
export const DEPOSIT_USER_REJECTED: 'USER_REJECTED';
export const DEPOSIT_SUBMISSION_REJECTED: 'WALLET_SUBMISSION_REJECTED';
export function depositWalletSubmissionCode(error: unknown): typeof DEPOSIT_INSUFFICIENT_FUNDS | typeof DEPOSIT_USER_REJECTED | typeof DEPOSIT_SUBMISSION_REJECTED | undefined;
export function uncertainDepositSubmission(error: unknown): Error & {code: 'AUTHORIZATION_UNCERTAIN'};
export function depositFailure(error: unknown, stage: string): Error & {depositFailure: DepositFailure; code: string};
export function publicDepositFailure(error: unknown): DepositFailure | undefined;
export function readDepositFailure(error: unknown): ReturnType<typeof depositFailure> | null;
export function familyProofFailure(error: unknown, stage: string): Error;
