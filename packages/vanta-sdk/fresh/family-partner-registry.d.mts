import type {Provider} from "ethers";
import type {VantaPolicyLookup,VantaPolicyOwnerScope,VantaPolicyRecoveryRuntime} from "./partner-policy-kzg.mjs";
export type VantaFamilyPartnerFees=readonly Readonly<{feeBps:number;minimumFee:bigint;maximumFee:bigint}>[];
export type VantaFamilyPartnerMembership=Readonly<{registry:string;pool:string;asset:string;
  relation:"combined"|"enhanced";basePartnerId:bigint;partnerId:string;operation:number;slot:number;
  root:bigint;policyContext:bigint;policyLookup:VantaPolicyLookup;version:bigint;
  receiverCommitment:bigint;authorizationKey:bigint;feeBps:number;feeMinimum:bigint;feeMaximum:bigint;
  finalizedBlock:number;finalizedBlockHash:string}>;
export type VantaFamilyPartnerIntent=Readonly<{schema:"vanta-family-kzg-partner-asset-intent-v1";assetIndex:number;asset:string;
  kind:"register"|"update"|"revoke";chainId:number;generationId:string;handleId:string;
  approval:Readonly<Record<string,unknown>>;request:Readonly<{chainId:number;registrar:string;
    calldata:string;settlementNonce:string;maxGasLimit:string}>;
  expectedRoots:readonly bigint[];expectedVersions:readonly bigint[];registryBlock:number;registryBlockHash:string}>;
export interface VantaFamilyPartnerWallet {
  exportFamilyPartnerReceivingRoute(input:{handle:string;releaseContext?:import("./family-network.mjs").FamilyReleaseContext}):Promise<Readonly<Record<string,unknown>>>;
  prepareFamilyPartnerHandleClaim(input:{handle:string;artifactBaseUrl:string;releaseContext?:import("./family-network.mjs").FamilyReleaseContext;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<Readonly<Record<string,unknown>>>;
  approveFamilyPartnerAction(input:{kind:"register"|"update"|"revoke";handle:string;
    claim?:Readonly<Record<string,unknown>>;fees:VantaFamilyPartnerFees;revision?:bigint;deadline:bigint;
    policyScope:VantaPolicyOwnerScope;artifactBaseUrl:string;releaseContext?:import("./family-network.mjs").FamilyReleaseContext;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<Readonly<Record<string,unknown>>>;
}
export interface VantaFamilyPartnerRegistry {
  readonly chainId:number;readonly generationId:string;readonly assetRegistrationVersion:3;
  readonly assets:readonly Readonly<{asset:string;symbol:string}>[];
  partnerAssets(input:{wallet:VantaFamilyPartnerWallet;handle:string}):Promise<Readonly<{registeredMask:number;revokedMask:number;assets:readonly string[]}>>;
  verifyHandleClaim(input:{claim:Readonly<Record<string,unknown>>}):Promise<boolean>;
  prepareHandleClaim(input:{wallet:VantaFamilyPartnerWallet;handle:string}):Promise<Readonly<{
    claim:Readonly<Record<string,unknown>>;alreadyClaimed:boolean;request:VantaFamilyPartnerIntent["request"]|null}>>;
  prepareRegistration(input:{wallet:VantaFamilyPartnerWallet;claim:Readonly<Record<string,unknown>>;
    feePolicy:VantaFamilyPartnerFees;asset:string;deadline?:bigint}):Promise<VantaFamilyPartnerIntent>;
  prepareFeeUpdate(input:{wallet:VantaFamilyPartnerWallet;handle:string;feePolicy:VantaFamilyPartnerFees;
    asset:string;deadline?:bigint}):Promise<VantaFamilyPartnerIntent>;
  prepareRevocation(input:{wallet:VantaFamilyPartnerWallet;handle:string;asset:string;deadline?:bigint}):Promise<VantaFamilyPartnerIntent>;
  resolveMembership(input:{asset:"native"|"token"|`0x${string}`;basePartnerId:bigint;operation:0|1|2|3|4|5;
    relation?:"combined"|"enhanced"}):Promise<VantaFamilyPartnerMembership>;
  bindCombinedWitness(input:{membership:VantaFamilyPartnerMembership;fee:unknown;partner:Readonly<Record<string,unknown>>}):Readonly<Record<string,unknown>>;
  bindEnhancedWitness(input:{membership:VantaFamilyPartnerMembership;fee:unknown;partner:Readonly<Record<string,unknown>>;
    protocolBps:number}):Readonly<Record<string,unknown>>;
  verifyReceipt(input:{prepared:VantaFamilyPartnerIntent;transactionHash:string}):Promise<Readonly<{
    transactionHash:string;blockNumber:number;blockHash:string;verifiedOnChain:true}>>;
  serializePending(prepared:VantaFamilyPartnerIntent):string;
  restorePending(serialized:string):VantaFamilyPartnerIntent;
  dispose():void;
}
export function createVantaFamilyPartnerRegistry(options:{releaseContext?:import("./family-network.mjs").FamilyReleaseContext;provider:Provider;verificationProvider:Provider;
  artifactBaseUrl:string;proofRuntime:VantaPolicyRecoveryRuntime;fetcher?:typeof fetch;signal?:AbortSignal
}):Promise<Readonly<VantaFamilyPartnerRegistry>>;
