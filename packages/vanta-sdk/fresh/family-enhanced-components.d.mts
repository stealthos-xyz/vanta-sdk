import type {Provider} from "ethers";
export interface VantaTypedAuthorizationWitness {
  readonly schema:"vanta-enhanced-authorization-witness-v1";readonly familyTag:string;
  readonly context:Readonly<{chainId:string;pool:string;asset:string;genesisHash:string;generationId:string;
    recipient:string;feePolicyHash:string;feeTermsHash:string;nonce:string;width:"8"|"32";
    authorizationEpoch:string;maximumWindowEpochs:string;minimumDelayEpochs:string;windowEnd:string}>;
  readonly claimKey:string;readonly reservationSalt:string;readonly payoutAtomic:string;readonly amountSalt:string;
  readonly legs:readonly [VantaTypedClaimLeg,VantaTypedClaimLeg,VantaTypedClaimLeg];
}
export interface VantaTypedClaimLeg {readonly amountAtomic:string;readonly notBeforeEpoch:string;readonly notAfterEpoch:string;}
export type VantaPreparedEnhancedComponent=Readonly<{schema:string;safeForFunds:false;publicSignals:readonly string[];
  readonly [name:string]:unknown}>;
export interface VantaFamilyEnhancedComponents {
  warmProofRuntime():Promise<void>;
  inspectClaims(input:{capabilities:readonly unknown[]}):Promise<readonly Readonly<Record<string,unknown>>[]>;
  inspectClaim(input:{capability:unknown}):Promise<Readonly<Record<string,unknown>>>;
  prepareAuthorization(input:{witness:VantaTypedAuthorizationWitness}):Promise<VantaPreparedEnhancedComponent>;
  proveAuthorization(input:{authorization:VantaPreparedEnhancedComponent;onLocalProof?:()=>void}):Promise<Readonly<Record<string,unknown>>>;
  prepareClaim(input:{capability:unknown;refresh:Readonly<{schema:"vanta-enhanced-claim-refresh-v1";safeForFunds:false;
    expected:unknown;checkpoint:unknown;reservationPath:unknown;predecessorPaths:readonly unknown[]}>}):Promise<VantaPreparedEnhancedComponent>;
  proveClaim(input:{claim:VantaPreparedEnhancedComponent}):Promise<Readonly<Record<string,unknown>>>;
  dispose():void;
}
/** Typed authorization and claim components. Prepared results do not authorize use of funds. */
export function createVantaFamilyEnhancedComponents(options:{releaseContext?:import("./family-network.mjs").FamilyReleaseContext;provider:Provider;verificationProvider:Provider;pool:string;
  artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<Readonly<VantaFamilyEnhancedComponents>>;
