export const VANTA_ROUTE:Readonly<{SWAP:4;BRIDGE:5}>;
export type VantaOperation='deposit'|'payment'|'private-send'|'withdrawal'|'enhanced-withdrawal'|'public-batch'|'swap'|'bridge';
export type VantaTransactionPhase='unknown'|'pending'|'proving'|'prepared'|'submitting'|'broadcast-uncertain'|'included'|'finalized'|'failed-finalized'|'failed'|'expired-unused'|'cancelled'|'private-output-pending'|'awaiting-delivery'|'delivery-failed'|'awaiting-claims'|'recovery-required';
export type VantaErrorCode='INVALID_ARGUMENT'|'NOT_READY'|'PERMISSION_DENIED'|'SESSION_EXPIRED'|'PASSWORD_REQUIRED'|'USER_REJECTED'|'WALLET_SUBMISSION_REJECTED'|'INSUFFICIENT_FUNDS'|'INTENT_NOT_FOUND'|'INTENT_EXPIRED'|'INVALID_REVIEW'|'INVALID_STATUS'|'STATE_CHANGED'|'AUTHORIZATION_UNCERTAIN'|'AUTHORIZATION_ALREADY_ATTEMPTED'|'STORE_UNAVAILABLE'|'RUNTIME_UNAVAILABLE'|'LOCAL_PROOF_FAILED'|'LOCAL_PROOF_RUNTIME_FAILED'|'LOCAL_PROOF_WORKER_FAILED'|'LOCAL_PROOF_ARTIFACT_UNAVAILABLE'|'LOCAL_PROOF_INPUT_REJECTED'|'DEPOSIT_FAILED'|'TRANSACTION_FAILED'|'CALL_EXCEPTION'|'UNKNOWN';
export type VantaRecoveryAction='reconcile'|'reconnect'|'review-again'|'inspect';
export const VANTA_ERROR_CODES:readonly VantaErrorCode[];
export class VantaSdkError extends Error {readonly code:VantaErrorCode;readonly recovery:VantaRecoveryAction;constructor(code?:VantaErrorCode);}
export function normalizeVantaError(error:unknown,options?:{submissionMayHaveStarted?:boolean}):VantaSdkError;
export type VantaProgressStage='connecting'|'wallet'|'synchronizing'|'quoting'|'preparing'|'authorizing'|'reconciling'|'history';
export type VantaProgressEvent=Readonly<{method:string;stage:VantaProgressStage;state:'started'|'completed'|'failed';code?:VantaErrorCode}>;
export type VantaProgressListener=(event:VantaProgressEvent)=>void|Promise<void>;
export type VantaTransactionStatus=Readonly<{id:string;operation:VantaOperation;phase:VantaTransactionPhase;complete:boolean;transactionHash:string|null;outputTransactionHash:string|null}>;
export function normalizeVantaTransactionStatus(input:{operation:VantaOperation;id?:string;result:unknown}):VantaTransactionStatus;
