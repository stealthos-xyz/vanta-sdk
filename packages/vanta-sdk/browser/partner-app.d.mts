import {createStealthOSAppWallet,SelectedFamilyWalletProvider,FamilyAsset} from './app-wallet';
export const STEALTHOS_SDK_VERSION:string;
export interface StealthOSPartnerConfiguration {schema:'stealthos-partner-integration-v1';sdkVersion:string;networkId:string;generationId:string;
 partnerHandle:string;handleId:string;application:import('../fresh/partner-application.mjs').PartnerApplication;serviceUrl:string;artifactBaseUrl:string;rpcUrl:string;assetConfigurationUrl:string;}
export function openStealthOSPartnerApp(input:{configuration:StealthOSPartnerConfiguration;provider:SelectedFamilyWalletProvider;asset?:FamilyAsset;
 workerUrl?:string|URL;onLocked?(reason:string):void}):Promise<Awaited<ReturnType<typeof createStealthOSAppWallet>> & {
 previewNetworkGas():Promise<{gasPriceWei:string;blockNumber:number;blockHash:string}>;
}>;
export function openStealthOSPublicPayment(input:{configuration:StealthOSPartnerConfiguration;provider:SelectedFamilyWalletProvider;recipient:string;
 workerUrl?:string|URL;onLocked?(reason:string):void}):Promise<Readonly<{
 context:import('../fresh/enhanced-host.mjs').EnhancedWithdrawalHostContext;recipient:string;
 quotePayment(input:{amountAtomic:string}):Promise<import('../fresh/family-deposit-host.mjs').FamilyDepositQuote>;
 approvePaymentAsset(input:{quoteId:string}):Promise<{transactionHash:string|null}>;
 prepareReviewedPayment(input:{quoteId:string}):Promise<import('../fresh/family-deposit-host.mjs').FamilyDepositReview>;
 executePayment(input:{preparedId:string}):Promise<{preparedId:string;transactionHash:string;phase:'broadcast-uncertain'}>;
 reconcilePayment(input:{preparedId:string;transactionHash?:string}):Promise<import('../fresh/family-deposit-host.mjs').FamilyDepositReview&{transactionHash:string|null}>;
 listPendingPayments():Promise<readonly import('../fresh/family-deposit-host.mjs').FamilyDepositReview[]>;dispose():void;
}>>;
