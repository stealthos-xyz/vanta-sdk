export interface FamilyDepositTransaction {
 readonly chainId:number; readonly from:string; readonly to:string;
 readonly data:string; readonly value:string;
}
export interface FamilyDepositReview {
 readonly preparedId:string; readonly networkId:string; readonly generationId:string;
 readonly pool:string; readonly asset:string; readonly assetSymbol:string; readonly payer:string;
 readonly amountAtomic:string; readonly protocolFeeAtomic:"0"; readonly partnerFeeAtomic:string; readonly netAmountAtomic:string;
 readonly deadline:number; readonly transactionDigest:string;
 /** Present only for public-wallet payments to an explicitly reviewed recipient. */
 readonly recipient?:string;
 readonly phase:"prepared"|"broadcast-uncertain"|"finalized"|"expired-unused"|"failed";
 readonly failure?:"insufficient-funds";
}
export interface FamilyDepositQuote extends Omit<FamilyDepositReview,'preparedId'|'phase'|'transactionDigest'> {
 readonly quoteId:string;readonly partnerId:string;readonly policyVersion:string;
 readonly receiverCommitment:string;readonly authorizationKey:string;
}
export interface FamilyDepositSession {
 readonly subjectId:string; readonly sessionId:string; readonly permissions:readonly string[];
 readonly expiresAt:number; readonly maximumDebitAtomic:string; readonly maximumSessionDebitAtomic:string;
}
export interface FamilyDepositPartnerRequest {
 readonly networkId:string; readonly generationId:string; readonly asset:string; readonly handleId:string;
 readonly request:Readonly<{payer:string;count:3;gross:string;protocolFeeCap:"0";partnerFeeCap:string;
 outputsHash:string;envelopesHash:string;feeSlotsHash:string;feeTermsHash:string;partnerRegistryRoot:string}>;
}
export interface FamilyDepositPartnerAuthorization {
 readonly handleId:string;readonly signerSalt:string;readonly requestNonce:string;readonly deadline:number;readonly signature:string;
}
export interface FamilyDepositHostOptions {
 readonly releaseContext?:import("./family-network.mjs").FamilyReleaseContext;
 readonly walletController?:{requireWallet():unknown};
 readonly paymentRecipient?:import('./family-note-delivery.mjs').FamilyNoteRecipient;
 readonly store:{readonly scope:string;read(namespace:string):Promise<unknown[]>;
 transact<T>(namespace:string,update:(rows:unknown[])=>{next:unknown[];result:T}):Promise<T>};
 readonly provider:unknown;readonly verificationProvider:unknown;
 readonly partnerAssetConfiguration?:Readonly<{url:string;handleId:string}>;
 readonly artifactBaseUrl:string;readonly relayerUrl:string;readonly walletAddress:string;
 readonly asset?:"native"|"token"|`0x${string}`;readonly fetcher?:typeof fetch;readonly signal?:AbortSignal;
 readonly onProgress?:(event:unknown)=>void;
 readonly getSession:()=>FamilyDepositSession;
 /** Trusted UI callback. Returning true approves exactly this displayed digest. */
 readonly approveDeposit:(review:FamilyDepositReview)=>Promise<boolean>;
 /** Trusted wallet bridge; callback receives exactly the reviewed transaction. */
 readonly submitTransaction:(request:FamilyDepositTransaction&Readonly<{preparedId:string;transactionDigest:string}>)=>Promise<Readonly<{transactionHash:string}>>;
 /** Authenticated partner-host API; response is cryptographically checked locally. */
}
export interface VantaFamilyDepositHost {
 quoteDeposit(input:Readonly<{amountAtomic:string;partnerHandle:string}>):Promise<FamilyDepositQuote>;
 prepareReviewedDeposit(input:Readonly<{quoteId:string}>):Promise<FamilyDepositReview>;
 warmProofRuntime():Promise<void>;
 warmWalletClearance():Promise<Readonly<{validUntil:number;encoded:string}>>;
 prepareDeposit(input:Readonly<{amountAtomic:string;partnerHandle:string}>):Promise<FamilyDepositReview>;
 executeDeposit(input:Readonly<{preparedId:string}>):Promise<Readonly<{preparedId:string;transactionHash:string;phase:"broadcast-uncertain"}>>;
 reconcileDeposit(input:Readonly<{preparedId:string;transactionHash?:string}>):Promise<FamilyDepositReview&Readonly<{transactionHash:string|null}>>;
 listDepositHistory():Promise<readonly (FamilyDepositReview&Readonly<{transactionHash:string|null}>)[]>;
 listPendingDeposits():Promise<readonly FamilyDepositReview[]>;
 dispose():void;
}
export function createVantaFamilyDepositHost(options:FamilyDepositHostOptions):Promise<VantaFamilyDepositHost>;
export function depositTransactionDigest(transaction:FamilyDepositTransaction):string;
