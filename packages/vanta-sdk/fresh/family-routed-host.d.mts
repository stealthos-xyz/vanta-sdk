import type{FamilyOperationFeeQuote}from'./family-operation-review.mjs';
import type {VantaFamilyEnhancedHostOptions} from './family-enhanced-host.mjs';
import type {FamilyPrivateSendReview} from './family-normal-host.mjs';
export interface FamilyRoutedReview extends Omit<FamilyPrivateSendReview,'recipient'|'phase'> {
 readonly phase:FamilyPrivateSendReview['phase']|'private-output-pending';
 readonly privateOutput?:boolean;readonly outputAsset?:string;readonly outputDecimals?:number;readonly outputAmountAtomic?:string;readonly outputTransactionHash?:string|null;
 readonly recipient:string;readonly operation:4|5;readonly transactionTarget:string;readonly publicReceiver:string;readonly minimumOutputAtomic:string;
 readonly maximumDeliveryFeeAtomic:string;readonly destinationChainId?:number;readonly messageId?:string|null;readonly delivery?:Readonly<{phase:'awaiting-delivery'|'delivery-failed'|'delivered-finalized';messageId:string;transactionHash?:string;blockNumber?:number;blockHash?:string;amountAtomic?:string;receiver?:string}>|null;
}
export interface FamilyRoutedQuote extends FamilyOperationFeeQuote {readonly privateOutput?:boolean;readonly outputAsset?:string;readonly publicReceiver:string;readonly minimumOutputAtomic:string;readonly maximumDeliveryFeeAtomic:string;readonly gasReserveAtomic:string;}
export interface FamilyRoutedHost {
 readonly context:Readonly<{networkId:string;generationId:string;pool:string;asset:string;assetSymbol:string;assetDecimals:number}>;
 balance():Promise<Readonly<{balanceAtomic:string;pool:string;asset:string;assetDecimals:number}>>;
 quote(input:{receiver:string;amountAtomic:string;minimumOutputAtomic:string;maximumDeliveryFeeAtomic?:string;partnerHandle:string;slippageBps?:number}):Promise<FamilyRoutedQuote>;
 prepareReviewed(input:{quoteId:string}):Promise<FamilyRoutedReview>;
 prepare(input:{receiver:string;amountAtomic:string;minimumOutputAtomic:string;maximumDeliveryFeeAtomic?:string;partnerHandle:string}):Promise<FamilyRoutedReview>;
 execute(input:{preparedId:string}):Promise<FamilyRoutedReview>;
 reconcile(input:{preparedId:string;transactionHash?:string}):Promise<FamilyRoutedReview>;
 monitorDelivery(input:{preparedId:string}):Promise<FamilyRoutedReview>;
 cancel(input:{preparedId:string}):Promise<FamilyRoutedReview>;
 list(options?:{cached?:boolean}):Promise<readonly FamilyRoutedReview[]>;dispose():void;
}
export function createVantaFamilyRoutedHost(options:Pick<VantaFamilyEnhancedHostOptions,
 'walletController'|'store'|'provider'|'verificationProvider'|'relayerUrl'|'walletAddress'|'asset'|'artifactBaseUrl'|'fetcher'|'releaseContext'|'signal'|'onProgress'|'getReviewDisplayCache'>&{partnerAssetConfiguration?:Readonly<{url:string;handleId:string}>;
 operation:4|5;approveRoute(review:FamilyRoutedReview):Promise<boolean>;
}):Promise<FamilyRoutedHost>;
