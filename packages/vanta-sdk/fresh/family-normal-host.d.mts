import type{FamilyOperationFeeQuote}from'./family-operation-review.mjs';
import type {FamilyPublicBatchQuote,VantaFamilyEnhancedHostOptions,VantaPublicBatchPayment} from './family-enhanced-host.mjs';
import type {FamilyNoteRecipient} from './family-note-delivery.mjs';
export {normalizeFamilyPrivateMemo,FAMILY_PRIVATE_MEMO_MAX_BYTES} from "./family-note-delivery.mjs";
export type {FamilyNoteRecipient} from './family-note-delivery.mjs';
export function encodeVantaFamilyReceivingAddress(recipient:FamilyNoteRecipient):string;
export function decodeVantaFamilyReceivingAddress(address:string):Readonly<FamilyNoteRecipient>;
export interface FamilyPrivateSendReview {
 readonly memo?:string;
 readonly preparedId:string;readonly phase:'proving'|'prepared'|'submitting'|'included'|'finalized'|'failed-finalized'|'failed'|'expired-unused'|'cancelled';
 readonly transactionHash:string|null;readonly transactionDigest:string|null;readonly recipient:FamilyNoteRecipient;readonly amountAtomic:string;
 readonly protocolFeeAtomic:string;readonly partnerFeeAtomic:string;readonly gasReserveAtomic:string;readonly totalDebitAtomic:string;readonly grossAmountAtomic?:string;
 readonly pool:string;readonly asset:string;readonly generationId:string;readonly deadline:number;
 readonly batch?:true;readonly recipientCount?:number;readonly payments?:readonly VantaPublicBatchPayment[];
}
export interface FamilyPrivateSendQuote extends FamilyOperationFeeQuote {readonly recipient:FamilyNoteRecipient;readonly gasReserveAtomic:string;}
export interface FamilyPrivateSendHost {
 warmProofRuntime():Promise<void>;
 readonly context:Readonly<{networkId:string;generationId:string;pool:string;asset:string;assetSymbol:string;assetDecimals:number}>;
 receivingAddress():Promise<Readonly<FamilyNoteRecipient>>;
 balance():Promise<Readonly<{balanceAtomic:string;pool:string;asset:string;assetDecimals:number}>>;
 quote(input:{recipient:FamilyNoteRecipient;amountAtomic:string;partnerHandle:string}):Promise<FamilyPrivateSendQuote>;
 prepareReviewed(input:{quoteId:string;batch?:boolean;memo?:string}):Promise<FamilyPrivateSendReview>;
 prepare(input:{recipient:FamilyNoteRecipient;amountAtomic:string;partnerHandle:string;memo?:string}):Promise<FamilyPrivateSendReview>;
 execute(input:{preparedId:string;batch?:boolean}):Promise<FamilyPrivateSendReview>;
 reconcile(input:{preparedId:string;transactionHash?:string;batch?:boolean}):Promise<FamilyPrivateSendReview>;
 cancel(input:{preparedId:string}):Promise<FamilyPrivateSendReview>;
 list():Promise<readonly FamilyPrivateSendReview[]>;
 dispose():void;
}
/** Instantiate inside a trusted local wallet worker. Private openings never
 * enter quote requests. The relayer pays network gas and receives the reviewed
 * proof-bound private gas note after explicit customer review. */
export function createVantaFamilyPrivateSendHost(options:Pick<VantaFamilyEnhancedHostOptions,
 'walletController'|'store'|'provider'|'verificationProvider'|'relayerUrl'|'walletAddress'|'asset'|'artifactBaseUrl'|'fetcher'|'releaseContext'|'signal'|'onProgress'|'getReviewDisplayCache'>&{partnerAssetConfiguration?:Readonly<{url:string;handleId:string}>;
 approvePrivateSend(review:FamilyPrivateSendReview):Promise<boolean>;
}):Promise<FamilyPrivateSendHost>;

export function createVantaFamilyWithdrawalHost(options:Parameters<typeof createVantaFamilyPrivateSendHost>[0]):Promise<Omit<FamilyPrivateSendHost,'quote'|'prepare'>&{
 quote(input:{recipient:string;amountAtomic:string;partnerHandle:string}):Promise<FamilyOperationFeeQuote>;
 quoteBatch(input:{payments:readonly VantaPublicBatchPayment[];partnerHandle:string}):Promise<FamilyPublicBatchQuote>;
 prepare(input:{recipient:string;amountAtomic:string;partnerHandle:string}):Promise<FamilyPrivateSendReview>;
}>;
