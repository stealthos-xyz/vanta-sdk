import type { EnhancedWithdrawalHost, EnhancedWithdrawalHostSession, EnhancedWithdrawalReview, EnhancedWithdrawalHostContext } from "./enhanced-host.mjs";
import type { createVantaLocalPrivacyWallet, VantaHostAtomicStore } from "./host-storage.mjs";
import type { EnhancedWalletJournalStore, EnhancedEncryptedRecoveryBackup } from "./enhanced-wallet-journal.mjs";
import type { FamilyRecoveryProvider } from "./family-note-recovery.mjs";

export interface EnhancedExecutionProvider extends Omit<FamilyRecoveryProvider, "getBlock"> {
  getBlock(block: number | "latest" | "finalized"): Promise<{
    number: number; hash: string | null; timestamp: number;
  } | null>;
  getTransaction(hash: string): Promise<{
    hash: string; to: string | null; from: string; chainId: bigint; value: bigint; data: string;
  } | null>;
  getTransactionReceipt(hash: string): Promise<{
    blockNumber: number; blockHash: string; status: number | null;
    logs: readonly { address: string; blockNumber: number; blockHash: string; transactionHash: string;
      index?: number; logIndex?: number; removed?: boolean; topics: readonly string[]; data: string }[];
  } | null>;
}
export interface VantaFamilyEnhancedHostOptions {
  readonly releaseContext?:import('./family-network.mjs').FamilyReleaseContext;
  /** Existing trusted local controller, using the existing dedicated privacy
   * vault. Its wallet and keys never enter a public host command payload. */
  readonly walletController: Pick<ReturnType<typeof createVantaLocalPrivacyWallet>, "requireWallet">;
  readonly store: VantaHostAtomicStore;
  readonly provider: EnhancedExecutionProvider;
  readonly verificationProvider: EnhancedExecutionProvider;
  /** Existing authenticated HTTPS gateway. It owns relay credentials.
   * Browser hosts require the same origin; Node hosts use their trusted
   * authenticated fetch adapter. Model tool inputs cannot select it. */
  readonly relayerUrl: string;
  readonly walletAddress:string;
  /** @deprecated Enhanced submissions use the private proof; this callback is not called. */
  readonly signConsent?:(request:import("./family-enhanced-relay.mjs").VantaFamilyEnhancedConsentRequest)=>Promise<string>;
  readonly asset?:"native"|"token"|`0x${string}`;
  readonly artifactBaseUrl: string;
  /** Application-authenticated fetch. Never pass a relay HMAC key to clients. */
  readonly fetcher?: typeof globalThis.fetch;
  /** Required in Node: use the existing durable encrypted SQLite adapter.
   * Browser hosts default to the account-scoped encrypted IndexedDB journal. */
  readonly journalStore?: EnhancedWalletJournalStore;
  readonly getSession: () => EnhancedWithdrawalHostSession;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: unknown) => void;
  /** Local display checkpoint for non-authorizing fee previews only. */
  readonly getReviewDisplayCache?: () => import('./family-note-recovery.mjs').FamilyDisplayCheckpointCache | undefined;
}
export interface VantaPublicBatchPayment { readonly recipient: string; readonly amountAtomic: string; }
export interface FamilyPublicBatchQuote {
 readonly quoteId:string;readonly grossAmountAtomic:string;readonly netPayoutAtomic:string;readonly protocolFeeAtomic:string;readonly partnerFeeAtomic:string;
 readonly gasReserveAtomic:string;readonly totalDebitAtomic:string;readonly asset:string;readonly expiresAt:number;
 readonly payments:readonly Readonly<VantaPublicBatchPayment&{grossAmountAtomic:string}>[];
}
export interface VantaPublicBatchStatus {
  readonly authorized: boolean;
  readonly authorizationFailed: boolean;
  readonly finalized: boolean;
  readonly transactionHash: string | null;
}
export interface VantaPublicBatchHost {
  readonly context: EnhancedWithdrawalHostContext;
  prepare(input: { payments: readonly VantaPublicBatchPayment[] }): Promise<EnhancedWithdrawalReview & Readonly<{
    payments: readonly VantaPublicBatchPayment[];
  }>>;
  authorize(input: { intentId: string }): Promise<Readonly<{ transactionId: string; status: VantaPublicBatchStatus }>>;
  monitor(input: { transactionId: string }): Promise<VantaPublicBatchStatus>;
  recover(input: { transactionId: string }): Promise<VantaPublicBatchStatus>;
  list(): Promise<readonly Readonly<{ transactionId: string; status: VantaPublicBatchStatus;payments:readonly VantaPublicBatchPayment[];amountAtomic:string;totalDebitAtomic:string }>[]>;
  listSaved(): ReturnType<VantaPublicBatchHost['list']>;
}
/** Runs in a dedicated browser wallet worker . Independently verifies the
 * signed compiled release on both RPCs, then composes actual note recovery,
 * fees, streamed proofs, one submission and canonical delayed-claim recovery.
 * No caller-controlled readiness flag or proof/execution callbacks exist. */
export interface FamilyWithdrawalQuote {readonly quoteId:string;readonly grossAmountAtomic?:string;readonly netPayoutAtomic:string;readonly protocolFeeAtomic:string;readonly partnerFeeAtomic:string;readonly gasReserveAtomic:string;readonly totalDebitAtomic:string;readonly asset:string;readonly destination:string;readonly enhanced:boolean;readonly windowSeconds:number;readonly expiresAt:number;}
export type FamilyWithdrawalRecord=Readonly<{transactionId:string;enhanced:true;status:import('./enhanced-host.mjs').EnhancedWithdrawalStatus}>|Readonly<{transactionId:string;enhanced:false;batch?:boolean;payments?:readonly VantaPublicBatchPayment[];amountAtomic?:string;totalDebitAtomic?:string;status:VantaPublicBatchStatus}>;
export function createVantaFamilyEnhancedHost(options: VantaFamilyEnhancedHostOptions): Promise<Readonly<{
  quoteWithdrawal(input:{amountAtomic:string;destination:string;enhanced:boolean;partnerHandle:string}):Promise<FamilyWithdrawalQuote>;
  quotePublicBatch(input:{payments:readonly VantaPublicBatchPayment[];partnerHandle:string}):Promise<FamilyPublicBatchQuote>;
  prepareReviewedPublicBatch(input:{quoteId:string}):Promise<EnhancedWithdrawalReview&Readonly<{payments:readonly VantaPublicBatchPayment[]}>>;
  prepareReviewedWithdrawal(input:{quoteId:string}):Promise<EnhancedWithdrawalReview&Readonly<{enhanced:boolean}>>;
  host: EnhancedWithdrawalHost;
  publicBatch: VantaPublicBatchHost;
  /** Encrypted bytes for the existing trusted backup UI. These methods are
   * intentionally absent from the model tool surface. Restore the same
   * authenticated account/network scope on a new device using its normal
   * privacy phrase flow, then import the backup and reconcile canonically. */
  exportRecoveryBackup(): Promise<EnhancedEncryptedRecoveryBackup>;
  importRecoveryBackup(backup: EnhancedEncryptedRecoveryBackup): Promise<Readonly<{ restored: number }>>;
  recoverNotes(options?:{displayCache?:import("./family-note-recovery.mjs").FamilyDisplayCheckpointCache}): Promise<Readonly<{ generationId: string; blockNumber: number; blockHash: string;
    complete:boolean; unavailablePools:readonly Readonly<{pool:string;asset:string;assetSymbol:string;reason:'history-unavailable'|'local-history-unavailable'}>[];
    receivedTransactions: readonly Readonly<{pool: string; transactionHash: string; blockNumber: number; amountAtomic: string; memo?: string}>[];
    pools: readonly Readonly<{ asset: string; assetDecimals: number; pool: string; spendableBalanceUnits: string;
      spentBalanceUnits: string; spendableCount: number; spentCount: number; verifiedEmpty: boolean }>[];
  }>>;
  dispose(): void;
}>>;
