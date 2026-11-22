import type {Provider} from "ethers";
import type {VantaFamilyPartnerRegistry,VantaFamilyPartnerWallet,VantaFamilyPartnerFees}
  from "./family-partner-registry.mjs";
import type {VantaHostWallet} from "./host-wallet.mjs";
import type {VantaHostAtomicStore} from "./host-storage.mjs";

export type VantaFamilyPartnerPending = Readonly<{
  status:"submitted"|"broadcast-uncertain"|"preparing"|"reverted";stage:"handle"|"registration"|"preparing";
  assets?:readonly string[];completedAssets?:readonly string[];totalAssets?:number;message?:string;canRetry?:boolean;canRecoverHash?:boolean;feeBps?:readonly number[];
  handle:string;transactionHash:string|null;
}>|Readonly<{status:"none"}>;
export type VantaFamilyPartnerRegistered = Readonly<{
  status:"registered";handle:string;transactionHash:string|null;generationId:string;assets?:readonly string[];completedAssets?:readonly string[];totalAssets?:number;feeBps?:readonly number[];
}>;
export interface VantaFamilyPartnerSignup {
  readonly version?:2;
  pendingStatus():Promise<VantaFamilyPartnerPending|VantaFamilyPartnerRegistered>;
  onboardPartner(input:{handle:string;fees:VantaFamilyPartnerFees;assets?:readonly string[]}):Promise<VantaFamilyPartnerPending|VantaFamilyPartnerRegistered>;
  updatePartnerFees?(input:{handle:string;fees:VantaFamilyPartnerFees;assets:readonly string[]}):Promise<VantaFamilyPartnerPending|VantaFamilyPartnerRegistered>;
  revokePartner?(input:{handle:string;assets:readonly string[]}):Promise<unknown>;
  recoverPending?(input?:{transactionHash?:string;retry?:boolean}):Promise<VantaFamilyPartnerPending|VantaFamilyPartnerRegistered>;
  resumePending():Promise<VantaFamilyPartnerPending|VantaFamilyPartnerRegistered>;
}
export function createVantaFamilyPartnerSignup(options:{
  registry:VantaFamilyPartnerRegistry;
  wallet:VantaFamilyPartnerWallet;
  hostWallet:VantaHostWallet;
  store:VantaHostAtomicStore;
  provider:Provider;
  verificationProvider:Provider;onProgress?:(progress:Readonly<{phase:string;asset?:string;completed:number;total:number}>)=>void;
}):Readonly<VantaFamilyPartnerSignup>;
