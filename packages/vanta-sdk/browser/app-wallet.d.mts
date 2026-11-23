import type { FamilyPrivateSendQuote } from '../fresh/family-normal-host.mjs';
import type { FamilyRoutedQuote } from '../fresh/family-routed-host.mjs';
import type { FamilyWithdrawalQuote, FamilyWithdrawalRecord } from '../fresh/family-enhanced-host.mjs';
import type { FamilyPrivateSendReview, FamilyNoteRecipient } from '../fresh/family-normal-host.mjs';
import type { FamilyRoutedReview } from '../fresh/family-routed-host.mjs';
import type { FamilyDepositReview } from "../fresh/family-deposit-host.mjs";
import type { EnhancedWithdrawalHost } from "./enhanced-types.d.mts";
export interface SelectedFamilyWalletProvider {
    request(input: {
        method: string;
        params?: unknown[];
    }): Promise<unknown>;
    on?(name: string, listener: () => void): void;
    removeListener?(name: string, listener: () => void): void;
}
export type FamilyCommand = "quotePublicBatch" | "prepareReviewedPublicBatch" | "authorizePublicBatch" | "monitorPublicBatch" | "openPublicPayment" | "create" | "unlock" | "restore" | "autoUnlock" | "passwordSettings" | "setPasswordRequirement" | "selectAsset" | "handleAvailable" | "claimHandle" | "checkHandle" | "currentHandle" | "findHandle" | "resolveHandle" | "recoverNotes" | "prepare" | "cancel" | "authorize" | "monitor" | "list" | "recover" | "exportRecoveryBackup" | "importRecoveryBackup" | "quoteDeposit" | "prepareReviewedDeposit" | "prepareDeposit" | "executeDeposit" | "reconcileDeposit" | "listDeposits" | "receivingAddress" | "preparePrivateSend" | "executePrivateSend" | "reconcilePrivateSend" | "cancelPrivateSend" | "listPrivateSends" | "quoteRouteFees" | "prepareReviewedRoute" | "quotePrivateSend" | "prepareReviewedPrivateSend" | "quoteWithdrawal" | "prepareReviewedWithdrawal" | "authorizeWithdrawal" | "listWithdrawals" | "monitorWithdrawal" | "quoteRoute" | "prepareRoute" | "executeRoute" | "reconcileRoute" | "cancelRoute" | "listRoutes";
export type FamilyAsset = 'native' | 'token' | `0x${string}`;
export type FamilyCustomerHandle = Readonly<{
    handle: string;
    phase: 'prepared' | 'submitting' | 'submitted' | 'confirmed';
    transactionHash: string | null;
}>;
type AuthenticatedSession = {
    subjectId: string;
    sessionId: string;
    expiresAt: number;
    wallet: string;
    networkId: string;
};
export type FamilyBootstrap = {
    rpcUrl: string;
    verificationRpcUrl: string;
    artifactBaseUrl: string;
    relayerUrl: string;
    asset?: FamilyAsset;
    paymentRecipient?: FamilyNoteRecipient;
    partnerAssetConfiguration?: {
        url: string;
        handleId: string;
    };
    session: AuthenticatedSession;
};
export type FamilyReleaseSummary = {
    chainId: number;
    networkLabel: string;
    generationId: string;
    ceremony: {
        releaseHash: string;
    };
    bootstrap: {
        finalizedBlockNumber: number | null;
    };
    pools: readonly {
        asset: string;
        pool: string;
    }[];
};
export type FamilyReceivedTransaction = {
    pool: string;
    transactionHash: string;
    blockNumber: number;
    amountAtomic: string;
    memo?: string;
};
export type FamilyNotesSummary = {
    generationId: string;
    blockNumber: number;
    blockHash: string;
    complete: boolean;
    /** Failed pools are omitted from `pools`; absence is never a zero balance. */
    unavailablePools: readonly { pool: string; asset: string; assetSymbol: string; reason: 'history-unavailable' | 'local-history-unavailable' }[];
    receivedTransactions: readonly FamilyReceivedTransaction[];
    pools: readonly {
        asset: string;
        assetDecimals: number;
        pool: string;
        spendableBalanceUnits: string;
        unreservedBalanceUnits?: string;
        availableBalanceUnits?: string;
        projectedBalanceUnits?: string;
        pendingChangeBalanceUnits?: string;
        spentBalanceUnits: string;
        spendableCount: number;
        spentCount: number;
        verifiedEmpty: boolean;
    }[];
};
export type FamilyCachedBalance = Readonly<{
    generationId: string;
    blockNumber: number;
    blockHash: string;
    pools: readonly Readonly<{
        pool: string;
        asset: string;
        assetDecimals: number;
        displayBalanceUnits: string;
    }>[];
}>;
export declare function createStealthOSAppWallet(input: {
    provider: SelectedFamilyWalletProvider;
    getSessionToken(): Promise<string>;
    serviceUrl?: string;
    workerUrl?: string | URL;
    rpcUrl: string;
    verificationRpcUrl: string;
    artifactBaseUrl: string;
    asset?: FamilyAsset;
    paymentRecipient?: FamilyNoteRecipient;
    assetConfiguration?: {
        url: string;
        handleId: string;
    };
    onLocked?(reason: "locked" | "background" | "contextChanged"): void;
}): Promise<Readonly<{
    release: FamilyReleaseSummary;
    hasBackup: boolean;
    requirePassword: boolean;
    canUnlockWithoutPassword: boolean;
    openPublicPayment(): Promise<import("./enhanced-types.d.mts").EnhancedWithdrawalHostContext>;
    approvePaymentAsset: ({ quoteId }: {
        quoteId: string;
    }) => Promise<{
        transactionHash: null;
    } | {
        transactionHash: string;
    }>;
    approveDepositAsset: ({ quoteId }: {
        quoteId: string;
    }) => Promise<{
        transactionHash: null;
    } | {
        transactionHash: string;
    }>;
    unlockRememberedWallet: () => Promise<undefined>;
    getPasswordSettings: () => Promise<{
        requirePassword: boolean;
        canUnlockWithoutPassword: boolean;
    }>;
    setPasswordRequirement: (requirePassword: boolean) => Promise<{
        requirePassword: boolean;
        canUnlockWithoutPassword: boolean;
    }>;
    createPrivateWallet({ password, confirmRecoveryPhrase }: {
        password: string;
        confirmRecoveryPhrase(phrase: string): Promise<boolean>;
    }): Promise<void>;
    restoreWallet({ password, phrase }: {
        password: string;
        phrase?: string;
    }): Promise<void>;
    publicReceivingIdentity(): Promise<{
        masterPublicKey: bigint;
        viewingPublicKey: Uint8Array<ArrayBufferLike>;
    }>;
    getCachedBalance: () => Readonly<{
        generationId: string;
        blockNumber: number;
        blockHash: string;
        pools: readonly Readonly<{
            pool: string;
            asset: string;
            assetDecimals: number;
            displayBalanceUnits: string;
        }>[];
    }> | null;
    recoverNotes: () => Promise<FamilyNotesSummary>;
    selectAsset(asset: FamilyAsset): Promise<void>;
    handleAvailable: (handle: string) => Promise<{
        handle: string;
        available: boolean;
    }>;
    claimHandle: (handle: string) => Promise<Readonly<{
        handle: string;
        phase: "prepared" | "submitting" | "submitted" | "confirmed";
        transactionHash: string | null;
    }>>;
    checkHandle: () => Promise<Readonly<{
        handle: string;
        phase: "prepared" | "submitting" | "submitted" | "confirmed";
        transactionHash: string | null;
    }> | null>;
    currentHandle: (handleHints?: readonly string[]) => Promise<Readonly<{
        handle: string;
        phase: "prepared" | "submitting" | "submitted" | "confirmed";
        transactionHash: string | null;
    }> | null>;
    findHandle: (handle: string) => Promise<Readonly<{
        handle: string;
        phase: "prepared" | "submitting" | "submitted" | "confirmed";
        transactionHash: string | null;
    }>>;
    resolveHandle: (handle: string) => Promise<FamilyNoteRecipient>;
    receivingAddress: () => Promise<FamilyNoteRecipient>;
    quoteRoute: (payload: {
        operation: 4 | 5;
        amountAtomic: string;
        slippageBps: number;
        receiver: string;
    }) => Promise<{
        amountOutAtomic: string;
        minimumOutputAtomic: string;
        maximumDeliveryFeeAtomic: string;
        outputDecimals: number;
    }>;
    quotePrivateSend: (payload: {
        recipient: FamilyNoteRecipient;
        amountAtomic: string;
        partnerHandle: string;
    }) => Promise<FamilyPrivateSendQuote>;
    prepareReviewedPrivateSend(payload: {
        quoteId: string;
        memo?: string;
    }): Promise<FamilyPrivateSendReview>;
    quoteRouteFees: (payload: {
        operation: 4 | 5;
        receiver: string;
        amountAtomic: string;
        minimumOutputAtomic: string;
        maximumDeliveryFeeAtomic: string;
        partnerHandle: string;
        slippageBps?: number;
    }) => Promise<FamilyRoutedQuote>;
    prepareReviewedRoute(payload: {
        operation: 4 | 5;
        quoteId: string;
    }): Promise<FamilyRoutedReview>;
    quotePublicBatch: (payload: {
        payments: readonly import("../fresh/family-enhanced-host.mjs").VantaPublicBatchPayment[];
        partnerHandle: string;
    }) => Promise<import("../fresh/family-enhanced-host.mjs").FamilyPublicBatchQuote>;
    prepareReviewedPublicBatch(payload: {
        quoteId: string;
    }): Promise<{
        intentId: string;
        review: FamilyPrivateSendReview;
    }>;
    authorizePublicBatch: (payload: {
        intentId: string;
    }) => Promise<{
        transactionId: string;
        status: import("../fresh/family-enhanced-host.mjs").VantaPublicBatchStatus;
    }>;
    monitorPublicBatch: (payload: {
        transactionId: string;
        historyAsset?: FamilyAsset;
    }) => Promise<import("../fresh/family-enhanced-host.mjs").VantaPublicBatchStatus>;
    quoteWithdrawal: (payload: {
        amountAtomic: string;
        destination: string;
        enhanced: boolean;
        partnerHandle: string;
    }) => Promise<FamilyWithdrawalQuote>;
    prepareReviewedWithdrawal(payload: {
        quoteId: string;
    }): Promise<{
        intentId: string;
        enhanced: boolean;
    }>;
    authorizeWithdrawal: (payload: {
        intentId: string;
        enhanced: boolean;
    }) => Promise<any>;
    listWithdrawals: (options?: {
        cached?: boolean;
        historyAsset?: FamilyAsset;
    }) => Promise<readonly FamilyWithdrawalRecord[]>;
    monitorWithdrawal: (payload: {
        transactionId: string;
        enhanced: boolean;
        historyAsset?: FamilyAsset;
    }) => Promise<any>;
    preparePrivateSend(payload: {
        recipient: FamilyNoteRecipient;
        amountAtomic: string;
        partnerHandle: string;
        memo?: string;
    }): Promise<FamilyPrivateSendReview>;
    executePrivateSend: (payload: {
        preparedId: string;
    }) => Promise<FamilyPrivateSendReview>;
    reconcilePrivateSend: (payload: {
        preparedId: string;
        historyAsset?: FamilyAsset;
    }) => Promise<FamilyPrivateSendReview>;
    cancelPrivateSend: (payload: {
        preparedId: string;
    }) => Promise<FamilyPrivateSendReview>;
    listPrivateSends(options?: {
        historyAsset?: FamilyAsset;
    }): Promise<readonly FamilyPrivateSendReview[]>;
    prepareRoute(payload: {
        operation: 4 | 5;
        receiver: string;
        amountAtomic: string;
        minimumOutputAtomic: string;
        maximumDeliveryFeeAtomic: string;
        partnerHandle: string;
    }): Promise<FamilyRoutedReview>;
    executeRoute: (payload: {
        operation: 4 | 5;
        preparedId: string;
    }) => Promise<FamilyRoutedReview>;
    reconcileRoute: (payload: {
        operation: 4 | 5;
        preparedId: string;
        historyAsset?: FamilyAsset;
    }) => Promise<FamilyRoutedReview>;
    cancelRoute: (payload: {
        operation: 4 | 5;
        preparedId: string;
    }) => Promise<FamilyRoutedReview>;
    listRoutes(operation: 4 | 5, options?: {
        cached?: boolean;
        historyAsset?: FamilyAsset;
    }): Promise<readonly FamilyRoutedReview[]>;
    quoteDeposit(payload: {
        amountAtomic: string;
        partnerHandle: string;
    }): Promise<import("../fresh/family-deposit-host.mjs").FamilyDepositQuote>;
    prepareReviewedDeposit(payload: {
        quoteId: string;
    }): Promise<FamilyDepositReview>;
    prepareDeposit(payload: {
        amountAtomic: string;
        partnerHandle: string;
    }): Promise<FamilyDepositReview>;
    executeDeposit: (payload: {
        preparedId: string;
    }) => Promise<{
        preparedId: string;
        transactionHash: string;
        phase: "broadcast-uncertain";
    }>;
    reconcileDeposit: (payload: {
        preparedId: string;
        transactionHash?: string;
        historyAsset?: FamilyAsset;
    }) => Promise<FamilyDepositReview & {
        transactionHash: string | null;
    }>;
    listDepositHistory: (options?: {
        historyAsset?: FamilyAsset;
    }) => Promise<readonly (FamilyDepositReview & {
        transactionHash: string | null;
    })[]>;
    listPendingDeposits(): Promise<readonly FamilyDepositReview[]>;
    exportRecoveryBackup(): Promise<string>;
    importRecoveryBackup(file: Blob): Promise<Readonly<{
        restored: number;
    }>>;
    getEnhancedHost(): EnhancedWithdrawalHost;
    lockWallet: () => void;
    dispose(): void;
}>>;
export {};
