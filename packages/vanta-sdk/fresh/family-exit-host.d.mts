import type {VantaFamilyEnhancedHostOptions} from './family-enhanced-host.mjs';
export interface FamilyExitReview {
 readonly preparedId:string;readonly networkId:string;readonly generationId:string;readonly pool:string;
 readonly recipient:string;readonly asset:string;readonly assetDecimals:number;readonly totalDebitAtomic:string;
 readonly payoutAtomic:string;readonly protocolFeeAtomic:string;readonly partnerFeeAtomic:string;
 readonly expiresAt:number;readonly sourceEpoch:number;readonly selectedNoteCount:number;
}
export interface FamilyExitStatus {readonly preparedId:string;readonly transactionHash:string|null;
 readonly phase:'proving'|'prepared'|'submitting'|'included'|'finalized'|'failed'|'expired-unused';}
export interface FamilyExitHost {
 readonly context:Readonly<{networkId:string;generationId:string;pool:string;asset:string}>;
 recoverNotes():Promise<Readonly<{networkId:string;generationId:string;pool:string;asset:string;assetDecimals:number;
  balanceAtomic:string;blockNumber:number;blockHash:string;sources:readonly Readonly<{epoch:number;count:number;balanceAtomic:string}>[] }>>;
 prepare(input:{recipient:string;sourceEpoch?:number}):Promise<FamilyExitReview>;
 execute(input:{preparedId:string}):Promise<FamilyExitStatus>;
 recover(input:{preparedId:string;transactionHash?:string}):Promise<FamilyExitStatus>;
 cancel(input:{preparedId:string}):Promise<{cancelled:true}>;
 list():Promise<readonly (FamilyExitReview&{status:FamilyExitStatus})[]>;
 exportRecoveryBackup():Promise<Readonly<{schema:'stealthos-family-exit-recovery-v1';networkId:string;generationId:string;pool:string;iv:string;ciphertext:string}>>;
 importRecoveryBackup(backup:unknown):Promise<Readonly<{restored:number}>>;
 dispose():void;
}
/** Trusted wallet-worker entrypoint. Approvals and gas payment remain with
 * the user. Existing original-generation keys and immutable exit fees apply. */
export function createVantaFamilyExitHost(options:Pick<VantaFamilyEnhancedHostOptions,'walletController'|'store'|'provider'|
 'verificationProvider'|'asset'|'artifactBaseUrl'|'fetcher'|'releaseContext'|'signal'|'onProgress'>&{
 approveExit(review:FamilyExitReview):Promise<boolean>;
 submitTransaction(request:Readonly<{chainId:number;to:string;value:string;data:string}>):Promise<{transactionHash:string}>;
}):Promise<FamilyExitHost>;
