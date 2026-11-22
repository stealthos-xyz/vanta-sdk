import type {VantaHostAtomicStore} from "./host-storage.mjs";
export interface VantaFamilyEnhancedConsentRequest {readonly intentId:string;readonly requestId:string;
  readonly pool:string;readonly asset:string;readonly calldata:string;}
export interface VantaFamilyEnhancedRelayOptions {readonly releaseContext?:import("./family-network.mjs").FamilyReleaseContext;readonly relayerUrl:string;
  readonly context:Readonly<{networkId:"eip155:6281971";generationId:string;pool:string;assetAddress:string}>;
  readonly walletAddress:string;readonly store:VantaHostAtomicStore;
  /** @deprecated Enhanced submissions use the private proof; this callback is not called. */
  readonly signConsent?:(request:VantaFamilyEnhancedConsentRequest)=>Promise<string>;
  readonly fetcher?:typeof fetch;readonly signal?:AbortSignal;}
export interface VantaFamilyEnhancedRelayTransport {
  quote(input:{requestId:string;width:8|32;batch?:unknown}):Promise<unknown>;
  prepare(input:{requestId:string;width:8|32;netPayoutAtomic:string}):Promise<unknown>;
  prepareBatch(input:{requestId:string;width:8|32;batch:unknown}):Promise<unknown>;
  terms(input:{requestId:string;outputs:unknown}):Promise<unknown>;
  bind(input:{requestId:string;header:unknown;nullifiers:unknown;envelopes:unknown;capabilities:readonly unknown[]}):Promise<unknown>;
  bindBatch(input:{requestId:string;header:unknown;nullifiers:unknown;envelopes:unknown;batch:unknown}):Promise<unknown>;
  sign(input:{requestId:string}):Promise<unknown>;
  submit(input:{intentId:string;requestId:string;calldata:string}):Promise<unknown>;
  monitor(input:{requestId:string}):Promise<unknown>;
  recover(input:{requestId:string}):Promise<unknown>;
  settlement(input:{requestId:string;transactionHash:string}):Promise<unknown>;
  dispose():void;
}
export function createVantaFamilyEnhancedRelayTransport(options:VantaFamilyEnhancedRelayOptions):Readonly<VantaFamilyEnhancedRelayTransport>;
