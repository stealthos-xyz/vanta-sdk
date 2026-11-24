export declare const VANTA_DOGEOS_FAMILY_TAG:string;
export interface VantaFamilyBound4Descriptor {
  readonly schema:"stealthos-family-bound4-driver-v2";
  readonly partnerPolicyScheme:"kzg-caulk-plus-cclink-v1";
  readonly familyId:"dogeos";readonly networkId:`eip155:${bigint}`;
  readonly familyTag:string;readonly engine:"STREAM_BOUND4";readonly workerCount:4;
}
export type VantaFamilyProofRelation="normal"|"exit"|"payout-aggregate"|"combined-fee-partner"|"enhanced-fee-partner";
export interface VantaFamilyProofSelection {
  readonly engine:"STREAM_BOUND4";readonly workerCount:4;readonly selectedDriver:string;
  readonly relation:VantaFamilyProofRelation;readonly width:0|8|32;
  readonly chainId:number;readonly familyTag:string;
}
export interface VantaBound4Worker {
  postMessage(message:unknown,transfer?:ArrayBuffer[]):void;
  addEventListener(type:"message"|"error",listener:(event:{data?:unknown;error?:unknown})=>void):void;
  removeEventListener(type:"message"|"error",listener:(event:{data?:unknown;error?:unknown})=>void):void;
  terminate():void;
}
export interface VantaBrowserBound4Release {
  readonly researchOnly:true;readonly profileName:"8x5"|"32x5";
  readonly glueUrl:string;readonly wasmUrl:string;readonly glueSha256:string;readonly wasmSha256:string;
}
export declare function validateVantaFamilyBound4Descriptor(value:unknown):Readonly<VantaFamilyBound4Descriptor>;
export declare function selectVantaFamilyBound4Driver(descriptor:unknown,
  relation:VantaFamilyProofRelation,width:0|8|32):Readonly<VantaFamilyProofSelection>;
export declare function selectVantaFamilyOperationProofs(descriptor:VantaFamilyBound4Descriptor,
  operation:"deposit"|"privateSend"|"withdraw"|"exit"|"aggregate",width:0|8|32):readonly VantaFamilyProofSelection[];
export interface VantaFamilyBound4Input {
  readonly descriptor:VantaFamilyBound4Descriptor;readonly relation:VantaFamilyProofRelation;
  readonly width:0|8|32;readonly wasm:Readonly<Record<string,unknown>>;
  readonly walletWitness:unknown;readonly signal?:AbortSignal;
  readonly policyLookupKey?:Uint8Array;readonly approvedPolicyLookupKeySha256?:string;
  readonly onProgress?:(stage:string)=>void;
  readonly onSelectedDriver?:(selection:VantaFamilyProofSelection)=>void;
  readonly createShardWorker:()=>VantaBound4Worker;
  readonly [key:string]:unknown;
}
/** Low-level local primitive. The compiled production runtime verifies signed activation first. */
export declare function proveVantaFamilyBound4InWallet(input:VantaFamilyBound4Input):Promise<Readonly<Record<string,unknown>>>;
export declare function createVantaBrowserBound4WorkerFactory(release:VantaBrowserBound4Release):()=>VantaBound4Worker;
export declare function initializeVantaBrowserBound4Runtime(input:{release:VantaBrowserBound4Release;
  signal?:AbortSignal;fetcher?:typeof fetch}):Promise<Readonly<{wasm:Readonly<Record<string,unknown>>;
  createShardWorker:()=>VantaBound4Worker}>>;

