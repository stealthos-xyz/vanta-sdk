import type {Provider} from "ethers";
import type {VantaFamilyProofRelation,VantaFamilyProofSelection} from "./family-proof-driver.mjs";
export interface VantaFamilyStandardProofRequest {
  readonly walletWitness:unknown;readonly expectedPublicSignals:readonly string[];
}
export interface VantaFamilyGate0ProofRequest {
  readonly walletWitness:unknown;readonly hashBinding:unknown;readonly authenticatedWalletCache:unknown;
  readonly expectedPublicStatement:string;readonly expectedCheckpointRef:string;readonly expectedSourceEpoch:number;
}
export type VantaFamilyLocalProof=Readonly<Record<string,unknown>>;
export interface VantaFamilyProofRuntime {
  readonly networkId:string;readonly generationId:string;readonly engine:"STREAM_BOUND4";readonly workerCount:4;
  warmDepositRuntime():Promise<void>;
  warmEnhancedRuntime():Promise<void>;
  buildVantaKzgPolicyLookup(corpus:Uint8Array,stateJson:string):Promise<string>;
  prepareEnhancedFee(input:{walletWitness:unknown;signal?:AbortSignal}):Promise<Readonly<{role:"enhanced-fee-partner";safeForFunds:false;publicSignals:readonly string[]}>>;
  prove(input:{relation:VantaFamilyProofRelation;width:0|8|32;
    request:VantaFamilyStandardProofRequest|VantaFamilyGate0ProofRequest;signal?:AbortSignal}):Promise<VantaFamilyLocalProof>;
  proveDeposit(input:{request:VantaFamilyStandardProofRequest;signal?:AbortSignal}):Promise<VantaFamilyLocalProof>;
  provePrivateSend(input:{width:8|32;fee:VantaFamilyStandardProofRequest;
    gate0:VantaFamilyGate0ProofRequest;signal?:AbortSignal}):Promise<Readonly<{combined:VantaFamilyLocalProof;normal:VantaFamilyLocalProof}>>;
  proveWithdrawal(input:{width:8|32;fee:VantaFamilyStandardProofRequest;
    gate0:VantaFamilyGate0ProofRequest;signal?:AbortSignal}):Promise<Readonly<{combined:VantaFamilyLocalProof;normal:VantaFamilyLocalProof}>>;
  proveExit(input:{width:8|32;request:VantaFamilyGate0ProofRequest;signal?:AbortSignal}):Promise<VantaFamilyLocalProof>;
  proveAggregation(input:{request:VantaFamilyStandardProofRequest;signal?:AbortSignal}):Promise<VantaFamilyLocalProof>;
  dispose():void;
}
/** Artifact locators cannot select keys, code, family, generation or proof mode. */
export declare function createVantaFamilyProofRuntime(options:{releaseContext?:import("./family-network.mjs").FamilyReleaseContext;provider:Provider;artifactBaseUrl:string;
  fetcher?:typeof fetch;signal?:AbortSignal;
  onProgress?:(progress:Readonly<{relation:VantaFamilyProofRelation;width:0|8|32;stage:string}>)=>void;
  onSelectedDriver?:(selection:VantaFamilyProofSelection)=>void;
}):Promise<Readonly<VantaFamilyProofRuntime>>;

