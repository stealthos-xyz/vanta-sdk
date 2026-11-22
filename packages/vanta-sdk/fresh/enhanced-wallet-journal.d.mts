import type { FamilyNoteDomain, FamilyNoteWallet, createFamilyNoteDelivery } from "./family-note-delivery.mjs";

export type EnhancedWalletJournalPhase = "prepared" | "authorizing" | "uncertain" | "submitted" | "included" | "finalized" | "expired-unused";
export interface EnhancedWalletJournalStatus {
  readonly preparedId: string;
  readonly intentId: string;
  readonly phase: EnhancedWalletJournalPhase;
  readonly transactionHash: string | null;
  readonly blockNumber: number | null;
  readonly blockHash: string | null;
}
export interface EnhancedClaimCapability {
  readonly schema: "vanta-enhanced-claim-capability-v1";
  readonly safeForFunds: false;
  readonly familyTag: string;
  readonly slot: 0 | 1 | 2;
  readonly openingHex: string;
}
export interface EnhancedWalletPreparation {
  readonly preparedId: string;
  readonly intentId: string;
  readonly intentBinding: string;
  readonly calldata: string;
  readonly nullifiers: readonly string[];
  readonly inputCommitments: readonly string[];
  readonly recipient: string;
  readonly netPayoutAtomic: string;
  readonly totalDebitAtomic: string;
  readonly capabilities: readonly EnhancedClaimCapability[];
}
/** Trusted local backend with one strict durable transaction per mutation.
 * It must share the supplied namespace across workers and target generations. */
export interface EnhancedWalletJournalStore {
  readonly scope?: string;
  read(namespace: string): Promise<unknown[]>;
  transact<T>(namespace: string, change: (entries: unknown[]) => { next: unknown[]; result: T }): Promise<T>;
}
export class EnhancedWalletJournalError extends Error { readonly code: string; }
export interface EnhancedWalletJournal {
  reserve(plan: EnhancedWalletPreparation): Promise<EnhancedWalletJournalStatus>;
  /** Private worker use only. Contains fixed payment capabilities and calldata. */
  readPrivate(preparedId: string): Promise<Readonly<Record<string, unknown>>>;
  list(): Promise<readonly EnhancedWalletJournalStatus[]>;
  /** Must finish before the sole off-chain authorization is requested. */
  arm(preparedId: string, intentBinding: string): Promise<EnhancedWalletJournalStatus>;
  recordTransactionHash(preparedId: string, hash: string): Promise<EnhancedWalletJournalStatus>;
  /** Uses complete canonical public history, never private RPC filters. */
  reconcile(preparedId: string): Promise<EnhancedWalletJournalStatus>;
  exportRecoveryBackup(attachments?: unknown): Promise<EnhancedEncryptedRecoveryBackup>;
  /** Restored entries cannot authorize again. Returns authenticated opaque
   * local host state only to the trusted wallet composition. */
  importRecoveryBackup(backup: EnhancedEncryptedRecoveryBackup): Promise<unknown>;
  close(): void;
}
export interface EnhancedEncryptedRecoveryBackup {
  readonly schema: "vanta-enhanced-encrypted-recovery-v1";
  readonly scope: string;
  readonly nonce: string;
  readonly ciphertext: string;
}
/** Candidate-internal composition. This does not activate a release. */
export function createEnhancedWalletJournal(options: {
  domain: FamilyNoteDomain;
  wallet: FamilyNoteWallet;
  delivery: ReturnType<typeof createFamilyNoteDelivery>;
  claimRuntime: {
    inspectClaim(input: { capability: EnhancedClaimCapability }): unknown | Promise<unknown>;
    inspectClaims?(input: { capabilities: readonly EnhancedClaimCapability[] }): Promise<readonly unknown[]>;
  };
  provider: unknown;
  verificationProvider: unknown;
  deploymentBlock: number;
  store?: EnhancedWalletJournalStore;
}): Promise<EnhancedWalletJournal>;
