import type {Provider} from "ethers";

export interface FamilySetup {
  schema: "stealthos-reusable-family-setup-v1";
  setupId: string;
  family: {id:string;namespace:"eip155";tag:string;
    activationAuthority:string};
  ceremonyId:string;
  sourceNetwork:{chainId:number;name:string};
  ceremonyReleaseHash:string;
  transcriptSha256:string;
  verifierKeysSha256:string;
  constructionPlanSha256:string;
  circuitInventorySha256:string;
  artifactInventorySha256:string;
  beaconAnchors:{phase1:string;terminal:string};
}
export interface FamilyNetwork {
  id:string;genesisHash:string;role:"testnet"|"mainnet";
}
export interface FamilyActivation {
  schema:"stealthos-family-network-activation-v1";
  setupId:string;familyId:string;familyTag:string;
  network:FamilyNetwork;revision:number;generationId:string;signature:string;
}
export interface FamilyDeployment {
  schema:"stealthos-family-deployment-lock-v1";
  setupId:string;generationId:string;familyId:string;familyTag:string;
  network:FamilyNetwork;
  contracts:ReadonlyArray<{kind:"verifier"|"pool"|"registry"|"bootstrap";
    name:string;address:string;codehash:string}>;
  relayerConfigSha256:string;lockId:string;signature:string;
}
export interface FamilyBuildPins {
  familyId:string;networkId:string;genesisHash:string;setupId:string;
  generationId:string;lockId:string;relayerConfigSha256:string;
  networkPolicySha256:string;
}
export interface ReviewedFamilyNetworkPolicy {
  schema:"stealthos-reviewed-family-networks-v1";
  familyId:string;sourceNetworkId:string;
  networks:ReadonlyArray<FamilyNetwork>;
}
export function assertPinnedFamilyEvmManifest(args:{
  setup:FamilySetup;activation:FamilyActivation;lock:FamilyDeployment;
  pins:FamilyBuildPins;networkPolicy:ReviewedFamilyNetworkPolicy;
}):Readonly<{setupId:string;generationId:string;lockId:string;
  networkId:string}>;
export function assertPinnedFamilyEvmRuntime(args:{
  provider:Provider;setup:FamilySetup;activation:FamilyActivation;
  lock:FamilyDeployment;pins:FamilyBuildPins;
  networkPolicy:ReviewedFamilyNetworkPolicy;
}):Promise<Readonly<{setupId:string;generationId:string;lockId:string;
  networkId:string;finalizedBlockHash:string;finalizedBlockNumber:number}>>;
export function verifyCompiledFamilyEvmRuntime(provider:Provider,releaseContext?:FamilyReleaseContext):
  Promise<Readonly<{setupId:string;generationId:string;lockId:string;
    networkId:string;finalizedBlockHash:string;finalizedBlockNumber:number}>>;
export function verifyCompiledFamilyExitRuntime(provider:Provider,releaseContext?:FamilyReleaseContext):
 ReturnType<typeof verifyCompiledFamilyEvmRuntime>;
/** Authenticate signed release pins locally, without a network scan. */
export function getCompiledFamilyWalletContext(releaseContext?:FamilyReleaseContext):Readonly<{setupId:string;generationId:string;lockId:string;networkId:string}>;
export function verifyCompiledFamilyOperationRuntime(provider:Provider,pool:string,releaseContext?:FamilyReleaseContext,roles?:readonly string[]):ReturnType<typeof verifyCompiledFamilyEvmRuntime>;
export function verifyCompiledFamilyRecoveryRuntime(provider:Provider,pool:string,releaseContext?:FamilyReleaseContext,roles?:readonly string[]):ReturnType<typeof verifyCompiledFamilyEvmRuntime>;

export interface FamilySdkRelease {
  schema:"stealthos-family-sdk-release-v2";
  setup:FamilySetup;activation:FamilyActivation;lock:FamilyDeployment;
  pins:FamilyBuildPins;networkPolicy:ReviewedFamilyNetworkPolicy;
  proving:import("./family-proof-resources.mjs").FamilyProofConfiguration;
}
/** Returns only the independently compiled release; an RPC cannot override it. */
export function getCompiledFamilyEvmRelease(releaseContext?:FamilyReleaseContext):FamilySdkRelease;
declare const compiledReleaseContext: unique symbol;
/** Opaque compiled capability; constructing a lookalike object cannot select a release. */
export interface FamilyReleaseContext {
 readonly [compiledReleaseContext]: true;
 readonly networkId:string;readonly generationId:string;readonly setupId:string;
 readonly mode:'active'|'withdraw-only';
}
export function getCompiledFamilyPoolGenerations():readonly FamilyReleaseContext[];
export function selectCompiledFamilyGeneration(input:{networkId:string;generationId?:string}):FamilyReleaseContext;
