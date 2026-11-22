/** Trusted wallet/agent host boundary. Context and authority are supplied by
 * application bootstrap, never by an untrusted tool call or browser global.
 */
export interface EnhancedWithdrawalHostContext {
  readonly networkId: string;
  readonly generationId: string;
  readonly pool: string;
  readonly assetAddress: string;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
}
export interface EnhancedWithdrawalAvailability {
  readonly status: "unqualified" | "ready";
  readonly reasonCode?: "NOT_READY" | "PERMISSION_DENIED" | "SESSION_EXPIRED";
}
export interface EnhancedWithdrawalReview {
  readonly intentId: string;
  /** The exact public net payout requested by the user, before any fee debit. */
  readonly netPayoutAtomic: string;
  readonly protocolFeeAtomic: string;
  readonly partnerFeeAtomic: string;
  readonly gasReserveAtomic: string;
  readonly totalDebitAtomic: string;
  readonly asset: string;
  readonly windowSeconds: number;
  /** Exclusive Unix-second expiry of this private review. */
  readonly expiresAt: number;
}
export type EnhancedWithdrawalClaimState = "waiting" | "prepared" | "submitted" | "included" | "finalized" | "recovery";
export interface EnhancedWithdrawalStatus {
  readonly completed: 0 | 1 | 2 | 3;
  readonly total: 3;
  readonly progress: "0/3" | "1/3" | "2/3" | "3/3";
  readonly authorized: boolean;
  readonly authorizationFailed: boolean;
  readonly failure?: "inputs-reserved" | "before-submission";
  readonly recoveryRequired: boolean;
  readonly claims: readonly Readonly<{
    number: 1 | 2 | 3;
    state: EnhancedWithdrawalClaimState;
    transactionHash: string | null;
  }>[];
}
export interface EnhancedWithdrawalHost {
  readonly context: EnhancedWithdrawalHostContext;
  getAvailability(): EnhancedWithdrawalAvailability;
  prepare(input: Readonly<{
    /** Exact requested net payout, in atomic asset units. */
    amountAtomic: string;
    destination: string;
  }>): Promise<EnhancedWithdrawalReview>;
  /** Cancel an unsigned review. Durable cleanup must release the exact locally
   * reserved input notes; it must not sign, relay, or spend. Retry is safe. */
  cancel(input: Readonly<{ intentId: string }>): Promise<Readonly<{ cancelled: true }>>;
  /** The sole off-chain user authorization. Scheduled claims never call this. */
  authorize(input: Readonly<{ intentId: string }>): Promise<Readonly<{
    transactionId: string;
    status: EnhancedWithdrawalStatus;
  }>>;
  monitor(input: Readonly<{ transactionId: string }>): Promise<EnhancedWithdrawalStatus>;
  /** Only this authenticated host/session's encrypted journal. No public lookup. */
  list(): Promise<readonly Readonly<{ transactionId: string; status: EnhancedWithdrawalStatus }>[]>;
  /** Display-only last observed statuses; performs no RPC or transaction checks. */
  listSaved(): Promise<readonly Readonly<{ transactionId: string; status: EnhancedWithdrawalStatus }>[]>;
  /** Reuses fixed claim capabilities and requires no additional user signature. */
  recover(input: Readonly<{ transactionId: string }>): Promise<EnhancedWithdrawalStatus>;
}

export type EnhancedWithdrawalPermission = "prepare" | "authorize" | "monitor" | "recover" | "cancel";
/** The local wallet cancel operation is intentionally not a model/MCP tool. */
export type EnhancedWithdrawalAgentPermission = Exclude<EnhancedWithdrawalPermission, "cancel">;
/** Authenticated delegation supplied synchronously by trusted application
 * bootstrap. Tools cannot set or extend these permissions. */
export interface EnhancedWithdrawalHostSession {
  readonly subjectId: string;
  readonly sessionId: string;
  /** Exclusive Unix-second expiry. */
  readonly expiresAt: number;
  readonly permissions: readonly EnhancedWithdrawalPermission[];
  readonly maximumDebitAtomic: string;
  /** Includes all completed or still-possible spending under this session. */
  readonly maximumSessionDebitAtomic: string;
  readonly allowedDestinations: readonly string[] | null;
}
export interface EnhancedWithdrawalRuntimePolicy {
  readonly windowEpochs: number;
  readonly minimumDelayEpochs: number;
  readonly maximumAuthorizationAgeEpochs: number;
  readonly reviewTtlSeconds: number;
}
export interface EnhancedWithdrawalPrepareRequest {
  readonly context: EnhancedWithdrawalHostContext;
  readonly intentId: string;
  readonly input: Readonly<{ amountAtomic: string; destination: string }>;
  readonly schedule: import("./enhanced-payouts.mjs").EnhancedPrivatePayoutSchedule;
  /** Maximum allowed exclusive Unix-second expiry of the returned review. */
  readonly expiresAt: number;
}
export interface EnhancedWithdrawalBoundIntent {
  readonly context: EnhancedWithdrawalHostContext;
  readonly intentId: string;
  readonly preparedId: string;
  readonly intentBinding: string;
  readonly input: Readonly<{ amountAtomic: string; destination: string }>;
  readonly review: EnhancedWithdrawalReview;
  readonly schedule: import("./enhanced-payouts.mjs").EnhancedPrivatePayoutSchedule;
}
/** Trusted local wallet composition, not model-controlled callbacks. It must
 * enforce the pinned release/domain, durable consumed-note reservations and
 * exact canonical funding/claim receipts. No callback may retry authorization
 * after an ambiguous signature. Only authorize may request a user signature.
 * Every prepared handle and fixed-claim capability must survive a restart in
 * encrypted account storage. Never publish local intent IDs or the schedule. */
export interface EnhancedWithdrawalHostRuntime {
  getPolicy(context: EnhancedWithdrawalHostContext): EnhancedWithdrawalRuntimePolicy | Promise<EnhancedWithdrawalRuntimePolicy>;
  prepare(request: EnhancedWithdrawalPrepareRequest): Promise<Readonly<{
    preparedId: string;
    review: EnhancedWithdrawalReview;
  }>>;
  /** Idempotently release only a never-signed prepared reservation. Must return
   * success only after the encrypted source-note lock is durably released; a
   * crash may cause this method to replay on the next prepare/cancel. */
  cancelPrepared(intent: EnhancedWithdrawalBoundIntent): Promise<Readonly<{ released: true }>>;
  authorize(intent: EnhancedWithdrawalBoundIntent): Promise<EnhancedWithdrawalStatus>;
  monitor(intent: EnhancedWithdrawalBoundIntent): Promise<EnhancedWithdrawalStatus>;
  recover(intent: EnhancedWithdrawalBoundIntent): Promise<EnhancedWithdrawalStatus>;
}
export interface EnhancedWithdrawalHostOptions {
  readonly context: EnhancedWithdrawalHostContext;
  readonly store: import("./host-storage.mjs").VantaHostAtomicStore;
  readonly runtime: EnhancedWithdrawalHostRuntime;
  readonly getSession: () => EnhancedWithdrawalHostSession;
}
export type EnhancedWithdrawalHostErrorCode = "INVALID_ARGUMENT" | "NOT_READY" | "PERMISSION_DENIED" |
  "SESSION_EXPIRED" | "INTENT_NOT_FOUND" | "INTENT_EXPIRED" | "AUTHORIZATION_UNCERTAIN" |
  "AUTHORIZATION_ALREADY_ATTEMPTED" | "STORE_UNAVAILABLE" | "RUNTIME_UNAVAILABLE" |
  "INVALID_REVIEW" | "INVALID_STATUS" | "STATE_CHANGED";
export class EnhancedWithdrawalHostError extends Error {
  readonly code: EnhancedWithdrawalHostErrorCode;
  constructor(code: EnhancedWithdrawalHostErrorCode);
}
/** The packaged release gate remains NOT_READY until frozen artifacts are
 * qualified. There is deliberately no enabled, readiness or verifier override. */
export function createEnhancedWithdrawalHost(options: EnhancedWithdrawalHostOptions): EnhancedWithdrawalHost;
export interface EnhancedWithdrawalAgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}
export interface EnhancedWithdrawalAgentTools {
  readonly tools: readonly EnhancedWithdrawalAgentTool[];
  invoke(name: string, input: unknown): Promise<Readonly<{
    isError: boolean;
    content: readonly Readonly<{ type: "text"; text: string }>[];
  }>>;
}
/** Transport-neutral MCP tool surface. Both bootstrap tool permissions and
 * the live host delegation must authorize an operation. */
export function createEnhancedWithdrawalAgentTools(options: Readonly<{
  host: EnhancedWithdrawalHost;
  permissions: readonly EnhancedWithdrawalAgentPermission[];
}>): EnhancedWithdrawalAgentTools;
