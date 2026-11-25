import {createStealthOSAppWallet,SelectedFamilyWalletProvider,FamilyAsset} from './app-wallet.mjs';
import type {FamilyPrivateSendReview} from '../fresh/family-normal-host.mjs';
import type {EnhancedWithdrawalReview,EnhancedWithdrawalStatus} from '../fresh/enhanced-host.mjs';
import type {VantaOperation,VantaProgressListener,VantaTransactionStatus} from '../api/developer.mjs';
export const STEALTHOS_SDK_VERSION:string;
export interface StealthOSPartnerConfiguration {schema:'stealthos-partner-integration-v1';sdkVersion:string;networkId:string;generationId:string;
 partnerHandle:string;handleId:string;application:import('../fresh/partner-application.mjs').PartnerApplication;serviceUrl:string;artifactBaseUrl:string;rpcUrl:string;verificationRpcUrl?:string;assetConfigurationUrl:string;}
type BaseWallet=Awaited<ReturnType<typeof createStealthOSAppWallet>>;
type BoundMethod='quoteDeposit'|'prepareDeposit'|'quotePrivateSend'|'quoteWithdrawal'|'quotePublicBatch'|'quoteRouteFees'|'preparePrivateSend'|'prepareRoute';
type BoundInput<T extends {partnerHandle:string}>=Omit<T,'partnerHandle'>&{/** @deprecated The registered configuration binds the partner. */partnerHandle?:string};
type BoundMethods={readonly [K in BoundMethod]:(input:BoundInput<Parameters<BaseWallet[K]>[0]>)=>ReturnType<BaseWallet[K]>};
export type VantaNormalWithdrawalReview=Readonly<Omit<FamilyPrivateSendReview,'recipient'>&{recipient:string}>;
export type VantaEnhancedAuthorization=Readonly<{transactionId:string;status:EnhancedWithdrawalStatus}>;
export type VantaWithdrawalPreparation=Readonly<{intentId:string;enhanced:false;review:VantaNormalWithdrawalReview}>|Readonly<EnhancedWithdrawalReview&{enhanced:true}>;
export interface VantaAuthorizeWithdrawal {
 (input:{intentId:string;enhanced:false}):Promise<VantaNormalWithdrawalReview>;
 (input:{intentId:string;enhanced:true}):Promise<VantaEnhancedAuthorization>;
 (input:{intentId:string;enhanced:boolean}):Promise<VantaNormalWithdrawalReview|VantaEnhancedAuthorization>;
}
export interface VantaMonitorWithdrawal {
 (input:{transactionId:string;enhanced:false;historyAsset?:FamilyAsset}):Promise<VantaNormalWithdrawalReview>;
 (input:{transactionId:string;enhanced:true;historyAsset?:FamilyAsset}):Promise<EnhancedWithdrawalStatus>;
 (input:{transactionId:string;enhanced:boolean;historyAsset?:FamilyAsset}):Promise<VantaNormalWithdrawalReview|EnhancedWithdrawalStatus>;
}
export type VantaPartnerWallet=Omit<BaseWallet,BoundMethod|'prepareReviewedWithdrawal'|'authorizeWithdrawal'|'monitorWithdrawal'>&BoundMethods&Readonly<{
 prepareReviewedWithdrawal(input:{quoteId:string}):Promise<VantaWithdrawalPreparation>;
 authorizeWithdrawal:VantaAuthorizeWithdrawal;
 monitorWithdrawal:VantaMonitorWithdrawal;
 previewNetworkGas():Promise<{gasPriceWei:string;blockNumber:number;blockHash:string}>;
 reconcileTransaction(input:{operation:Exclude<VantaOperation,'payment'>;id:string;historyAsset?:FamilyAsset;transactionHash?:string}):Promise<VantaTransactionStatus>;
}>;
export function openStealthOSPartnerApp(input:{configuration:StealthOSPartnerConfiguration;provider:SelectedFamilyWalletProvider;asset?:FamilyAsset;
 workerUrl?:string|URL;onLocked?(reason:string):void;onProgress?:VantaProgressListener}):Promise<VantaPartnerWallet>;
export function openStealthOSPublicPayment(input:{configuration:StealthOSPartnerConfiguration;provider:SelectedFamilyWalletProvider;recipient:string;
 workerUrl?:string|URL;onLocked?(reason:string):void;onProgress?:VantaProgressListener}):Promise<Readonly<{
 context:import('../fresh/enhanced-host.mjs').EnhancedWithdrawalHostContext;recipient:string;
 quotePayment(input:{amountAtomic:string}):Promise<import('../fresh/family-deposit-host.mjs').FamilyDepositQuote>;
 approvePaymentAsset(input:{quoteId:string}):Promise<{transactionHash:string|null}>;
 prepareReviewedPayment(input:{quoteId:string}):Promise<import('../fresh/family-deposit-host.mjs').FamilyDepositReview>;
 executePayment(input:{preparedId:string}):Promise<{preparedId:string;transactionHash:string;phase:'broadcast-uncertain'}>;
 reconcilePayment(input:{preparedId:string;transactionHash?:string}):Promise<import('../fresh/family-deposit-host.mjs').FamilyDepositReview&{transactionHash:string|null}>;
 reconcileTransaction(input:{id:string;transactionHash?:string}):Promise<VantaTransactionStatus>;
 listPendingPayments():Promise<readonly import('../fresh/family-deposit-host.mjs').FamilyDepositReview[]>;dispose():void;
}>>;
