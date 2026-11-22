import type {VantaPartnerPolicyKzgProfile} from "./partner-policy-kzg.mjs";
import type {FamilySdkRelease} from "./family-network.mjs";
import type {VantaFamilyBound4Descriptor} from "./family-proof-driver.mjs";
import type {FamilyRoutedResources} from './family-routed-resources.mjs';
export interface FamilyProofResourcePin {readonly path:string;readonly sha256:string;readonly bytes:number;}
export interface FamilyEnhancedComponentResource {
  readonly r1csSha256:string;readonly publicInputs:19|15;
  readonly provingKey:FamilyProofResourcePin;readonly verificationKey:FamilyProofResourcePin;
  readonly runtime:Readonly<{glue:FamilyProofResourcePin;wasm:FamilyProofResourcePin}>;
  readonly verifier:Readonly<{name:"enhanced-authorization"|"enhanced-claim";address:string;codehash:string}>;
}
export interface FamilyProofConfiguration {readonly driver:VantaFamilyBound4Descriptor;readonly resourcesSha256:string;
  readonly circuits:ReadonlyArray<Readonly<{id:string;r1csSha256:string;sourceSha256:string;familyTag:string}>>;}
export interface FamilyProofResourceInventory {
  readonly schema:"stealthos-family-bound4-resources-v2";readonly familyId:string;readonly familyTag:string;
  readonly networkId:string;readonly setupId:string;readonly generationId:string;readonly sourceCommit:string;
  readonly partnerPolicyKzg:VantaPartnerPolicyKzgProfile;
  readonly credentials:Readonly<Record<"handle-register"|"partner-owner",Readonly<Record<"witnessWasm"|"zkey"|"verificationKey",FamilyProofResourcePin>>>>;
  readonly enhancedComponents:Readonly<Record<"enhanced-authorization"|"enhanced-claim",Readonly<FamilyEnhancedComponentResource>>>;
  readonly funding:Readonly<{schema:"vanta-family-kzg-funding-resources-v1";routes?:FamilyRoutedResources;publicCache:Readonly<{runtime:Readonly<{glue:FamilyProofResourcePin;wasm:FamilyProofResourcePin;rawWasm:FamilyProofResourcePin;build:FamilyProofResourcePin}>;corpus:FamilyProofResourcePin;metadata:FamilyProofResourcePin}>;pools:readonly Readonly<{pool:string;asset:string;poolCodehash:string;deploymentBlock:number;assetSymbol:string;assetDecimals:number;protocolBps:number;relayerAddress:string;hostPolicy:Readonly<{windowEpochs:number;minimumDelayEpochs:number;maximumAuthorizationAgeEpochs:number;reviewTtlSeconds:number}>}>[]}>;
  readonly profiles:Readonly<Record<string,Readonly<Record<string,unknown>>>>;
}
export declare function validateVantaFamilyProofConfiguration(value:unknown,release:FamilySdkRelease):Readonly<FamilyProofConfiguration>;
export declare function validateVantaFamilyEnhancedComponentResources(value:unknown,configuration:FamilyProofConfiguration,
  release:FamilySdkRelease):Readonly<Record<"enhanced-authorization"|"enhanced-claim",FamilyEnhancedComponentResource>>;
export declare function validateVantaFamilyProofResources(value:unknown,release:FamilySdkRelease):Readonly<FamilyProofResourceInventory>;
export declare function getCompiledVantaFamilyProofResources(release:FamilySdkRelease,releaseContext?:import("./family-network.mjs").FamilyReleaseContext):Readonly<FamilyProofResourceInventory>;
export declare function familyProofResourceLeaves(inventory:Pick<FamilyProofResourceInventory,"profiles">&Partial<Pick<FamilyProofResourceInventory,"partnerPolicyKzg"|"credentials"|"enhancedComponents"|"funding">>):FamilyProofResourcePin[];
export declare function createVantaFamilyProofArtifactReader(options:{artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal}):Readonly<{
  url(pin:FamilyProofResourcePin):string;bytes(pin:FamilyProofResourcePin):Promise<Uint8Array>;
  range(pin:FamilyProofResourcePin,offset:number,length:number):Promise<Uint8Array>;
}>;
export declare function assertVantaFamilyStreamManifestPins(input:{name:string;profile:Readonly<Record<string,unknown>>;
  key:unknown;matrix:unknown;driver:VantaFamilyBound4Descriptor}):void;

