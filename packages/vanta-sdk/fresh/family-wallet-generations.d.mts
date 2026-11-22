import type {FamilyReleaseContext} from './family-network.mjs';
import type {VantaHostAtomicStore} from './host-storage.mjs';
import type {FamilyExitHost,FamilyExitReview} from './family-exit-host.mjs';
import type {FamilyDepositHostOptions,VantaFamilyDepositHost} from './family-deposit-host.mjs';
import type {VantaFamilyEnhancedHostOptions} from './family-enhanced-host.mjs';
export interface FamilyGenerationSelection {networkId:string;generationId?:string;asset?:'native'|'token'|`0x${string}`;}
export function createVantaFamilyGenerationWallet(options:{
 walletController:VantaFamilyEnhancedHostOptions['walletController'];
 getStore(context:FamilyReleaseContext):Promise<VantaHostAtomicStore>|VantaHostAtomicStore;
 getProviders(networkId:string):Promise<Pick<VantaFamilyEnhancedHostOptions,'provider'|'verificationProvider'>>|Pick<VantaFamilyEnhancedHostOptions,'provider'|'verificationProvider'>;
 artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;onProgress?:(value:unknown)=>void;
 approveExit(review:FamilyExitReview):Promise<boolean>;
 submitTransaction(request:Readonly<{chainId:number;to:string;value:string;data:string}>):Promise<{transactionHash:string}>;
}):{
 generations():readonly Readonly<FamilyReleaseContext&{pools:readonly Readonly<{pool:string;asset:string;symbol:string;decimals:number;mode:'active'|'withdraw-only'}>[]}>[];
 openWithdrawal(selection:FamilyGenerationSelection):Promise<FamilyExitHost>;
 openDeposit(selection:FamilyGenerationSelection&Pick<FamilyDepositHostOptions,'relayerUrl'|'walletAddress'|'getSession'|'approveDeposit'|'submitTransaction'|'authorizePartnerDeposit'>):Promise<VantaFamilyDepositHost>;
 dispose():void;
};
