import type {Provider} from "ethers";
import type {VantaFamilyLocalProof} from "./family-proof-runtime.mjs";
import type {VantaFamilyProofSelection} from "./family-proof-driver.mjs";
export interface VantaFamilyEnhancedFeeInput {
  readonly asset:"native"|"token"|`0x${string}`;readonly basePartnerId:bigint;
  readonly operation:0|3;readonly width:8|32;readonly fee:unknown;
  readonly partner:Readonly<Record<string,unknown>>;readonly protocolBps:number;
  readonly expectedPublicSignals:readonly string[];readonly signal?:AbortSignal;
}
export interface VantaFamilyEnhancedFeeProver {
  warmProofRuntime():Promise<void>;
  inspectMembership(input:{asset:"native"|"token"|`0x${string}`;basePartnerId:bigint;operation:0|3}):Promise<Readonly<Record<string,unknown>>>;
  prepare(input:Omit<VantaFamilyEnhancedFeeInput,"expectedPublicSignals">):Promise<Readonly<{role:"enhanced-fee-partner";safeForFunds:false;publicSignals:readonly string[]}>>;
  provePrepared(input:{prepared:Readonly<{role:"enhanced-fee-partner";safeForFunds:false;publicSignals:readonly string[]}>}):Promise<VantaFamilyLocalProof>;
  prove(input:VantaFamilyEnhancedFeeInput):Promise<VantaFamilyLocalProof>;
  dispose():void;
}
/** Runs only in a dedicated local proof worker with a compiled V2 activation. */
export function createVantaFamilyEnhancedFeeProver(options:{releaseContext?:import("./family-network.mjs").FamilyReleaseContext;provider:Provider;verificationProvider:Provider;
  artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;
  onProgress?:(progress:unknown)=>void;onSelectedDriver?:(selection:VantaFamilyProofSelection)=>void;
}):Promise<Readonly<VantaFamilyEnhancedFeeProver>>;
