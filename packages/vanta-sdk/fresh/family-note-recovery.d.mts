import type { FamilyNoteDomain, FamilyNoteOpening, FamilyNoteWallet, createFamilyNoteDelivery } from "./family-note-delivery.mjs";
export interface FamilyRecoveryProvider {
  getNetwork(): Promise<{ chainId: bigint }>;
  getBlock(block: number | "finalized"): Promise<{ number: number; hash: string | null } | null>;
  getCode(address: string, block: number): Promise<string>;
  call(transaction: { to: string; data: string; blockTag: number }): Promise<string>;
  getLogs(filter: { address: string; fromBlock: number; toBlock: number; topics: string[][] }): Promise<readonly {
    address: string; blockNumber: number; blockHash: string; transactionHash: string; index?: number; logIndex?: number;
    removed?: boolean; topics: readonly string[]; data: string;
  }[]>;
}
export interface FamilyDisplayCheckpointCache {
  readCheckpoint(pool:string):Promise<unknown>;
  saveCheckpoint(pool:string,checkpoint:unknown,discardedAnchor?:Readonly<{number:number;hash:string}>):Promise<void>;
}
export function recoverFamilyCanonicalNotes(input: {
  provider: FamilyRecoveryProvider;
  verificationProvider?: FamilyRecoveryProvider;
  delivery: ReturnType<typeof createFamilyNoteDelivery>;
  wallet: FamilyNoteWallet;
  deploymentBlock: number;
  chunkBlocks?: number;
  confirmedAnchor?: Readonly<{number:number;hash:string}>;
  displayCache?: FamilyDisplayCheckpointCache;
  useSharedHistory?: boolean;
}): Promise<Readonly<{
  schema: "vanta-family-canonical-note-recovery-v1";
  safeForFunds: false;
  ceremonyReady: false;
  context: Readonly<FamilyNoteDomain>;
  blockNumber: number;
  blockHash: string;
  deploymentBlock: number;
  complete: boolean;
  verifiedEmpty: boolean;
  resumedDisplayCheckpoint?: true;
  publicRows: number;
  receivedTransactions: readonly Readonly<{transactionHash: string; blockNumber: number; amountAtomic: string; memo?: string}>[];
  publicCommitments:readonly Readonly<{epoch:number;row:number;commitment:string}>[];
  epochs: readonly Readonly<{ epoch: number; rows: number; checkpoint: string; x: string; y: string; closed: boolean }>[];
  notes: readonly Readonly<{
    epoch: number; row: number; transactionHash: string; blockNumber: number; commitment: string; envelopeHash: string;
    opening: Readonly<FamilyNoteOpening>; nullifier: string | null; status: "spendable" | "spent" | "nonspendable";
    spentTransactionHash?: string;
    memo?: string;
  }>[];
  quarantined: readonly Readonly<{
    epoch: number; row: number; commitment: string; transactionHash: string;
    reason: "INVALID_DELIVERY" | "DUPLICATE_SPEND_AUTHORITY";
  }>[];
  verifiedSpendableAtomic: string;
  balanceAtomicAtAnchor: string | null;
}>>;
