export const DEPOSIT_STAGES: readonly string[];
export interface DepositFailure {readonly code: string; readonly cause: string; readonly stage: string}
export const DEPOSIT_INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS';
export function depositWalletSubmissionCode(error: unknown): typeof DEPOSIT_INSUFFICIENT_FUNDS | undefined;
export function depositFailure(error: unknown, stage: string): Error & {depositFailure: DepositFailure; code: string};
export function publicDepositFailure(error: unknown): DepositFailure | undefined;
export function readDepositFailure(error: unknown): ReturnType<typeof depositFailure> | null;
export function familyProofFailure(error: unknown, stage: string): Error;
