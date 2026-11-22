export type VantaHostContext = Readonly<{
  /** Stable, local host account identifier. Never a secret or login challenge. */
  accountId: string;
  networkId: `eip155:${number}`;
  generationId: `0x${string}`;
}>;
export type VantaHostCommand = "status" | "createWallet" | "unlockWallet" |
  "restoreWallet" | "backupWallet" | "recover" | "reconcile" |
  "deposit" | "privateSend" | "withdraw" | "swap" | "bridge";
export type VantaHostPhase = "idle" | "prepared" | "reserved" | "proving" |
  "awaiting-approval" | "broadcast-uncertain" | "submitted" | "included" |
  "finalized" | "expired-unused" | "destination-pending" | "delivered" |
  "failed" | "reconciliation-required";
export type VantaHostProgress = Readonly<{
  stage: "initializing" | "unlocking" | "recovering" | "loading-artifacts" |
    "proving" | "awaiting-approval" | "submitting" | "reconciling" |
    "settling" | "complete";
  fraction?: number;
}>;
/** Owner-visible summaries only. Never put a phrase, opening, key or witness here. */
export type VantaHostResult = Readonly<{
  walletReady?: boolean;
  backupConfirmed?: boolean;
  reconciled?: boolean;
  operationId?: string;
  phase?: VantaHostPhase;
  transactionHash?: `0x${string}`;
  destinationTransactionHash?: `0x${string}`;
  messageId?: `0x${string}`;
  balances?: readonly Readonly<{
    asset: string; spendableUnits: string; pendingUnits: string;
  }>[];
  pendingOperations?: readonly Readonly<{
    operationId: string; phase: VantaHostPhase; transactionHash?: `0x${string}`;
  }>[];
}>;
type FeeBound = Readonly<{partnerHandle?: string; maxFeeUnits?: string}>;
type AssetAmount = Readonly<{asset: string; amountUnits: string}>;
export type VantaHostPayloads = {
  status: Record<string, never>;
  createWallet: Record<string, never>;
  unlockWallet: Record<string, never>;
  restoreWallet: Record<string, never>;
  backupWallet: Record<string, never>;
  recover: Record<string, never>;
  reconcile: Record<string, never>;
  deposit: AssetAmount & FeeBound;
  privateSend: AssetAmount & FeeBound & Readonly<{recipient: string}>;
  withdraw: AssetAmount & FeeBound & Readonly<{recipient: string}>;
  swap: FeeBound & Readonly<{fromAsset: string; toAsset: string;
    amountUnits: string; minimumOutputUnits: string; routeId: string; deadline?: number}>;
  bridge: AssetAmount & FeeBound & Readonly<{recipient: string;
    destinationNetworkId: `eip155:${number}`; routeId: string}>;
};
/** Structural local transport contract; no DOM or native framework types. */
export interface VantaLocalMessageEvent {
  readonly data: unknown;
}
export interface VantaLocalWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: VantaLocalMessageEvent) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: VantaLocalMessageEvent) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: () => void): void;
}
export type VantaHostWorkerState = Readonly<{
  phase: "stopped" | "initializing" | "ready" | "disposed";
  context: VantaHostContext;
  needsReconciliation: boolean;
  capabilities: readonly VantaHostCommand[];
}>;
export declare class VantaHostWorkerError extends Error {
  constructor(code: string);
  readonly code: string;
}
export declare function createVantaHostWorker(options: Readonly<{
  /** Must create a new bundled, local module Worker. No remote prover. */
  createWorker(): VantaLocalWorker;
  context: VantaHostContext;
  timeoutMs?: number;
  onProgress?(progress: VantaHostProgress & Readonly<{
    operation: VantaHostCommand | "initialize";
  }>): void;
}>): Readonly<{
  start(options?: Readonly<{signal?: AbortSignal}>): Promise<VantaHostWorkerState>;
  state(): VantaHostWorkerState;
  request<C extends VantaHostCommand>(command: C, payload?: VantaHostPayloads[C],
    options?: Readonly<{signal?: AbortSignal}>): Promise<VantaHostResult>;
  /** Stop on native lock/background/termination; also stop before switching accounts. */
  stop(reason?: "LOCKED" | "BACKGROUNDED" | "CONTEXT_CHANGED" | "TERMINATED" | "ABORTED"): void;
  changeContext(context: VantaHostContext): void;
  dispose(): void;
}>;
