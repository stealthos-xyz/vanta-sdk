import type {VantaFamilyPartnerWallet} from "./family-partner-registry.mjs";
export type VantaFamilyBootstrapIdentity="protocol"|"relayer";
/** Public, signed setup/activation and the operator's selected deployment plan.
 * Produces a credential-only capability; it does not enable funded SDK APIs. */
export declare function createFamilyBootstrapCredentialScope(
  descriptor:Readonly<Record<string,unknown>>,expected:Readonly<Record<string,unknown>>):object;
export declare class VantaFreshPrivateWallet {
  static create():Promise<Readonly<{wallet:VantaFreshPrivateWallet;recoveryPhrase:string}>>;
  static restore(phrase:string):Promise<VantaFreshPrivateWallet>;
  privateWalletKeys():Promise<unknown>;
  publicReceivingIdentity():Promise<Readonly<{
    masterPublicKey:bigint;viewingPublicKey:Uint8Array;
  }>>;
  publicBootstrapIdentity():Promise<Readonly<{authorizationCommitment:bigint;proofCommitment:bigint}>>;
  prepareFamilyBootstrapHandleClaim(input:Readonly<{
    identity:VantaFamilyBootstrapIdentity;credentialScope:object;artifactBaseUrl:string;
    fetcher?:typeof fetch;signal?:AbortSignal;
  }>):ReturnType<VantaFamilyPartnerWallet["prepareFamilyPartnerHandleClaim"]>;
  prepareFamilyBootstrapCollector(input:Readonly<{
    identity:VantaFamilyBootstrapIdentity;credentialScope:object;pool:string;deadline:bigint;artifactBaseUrl:string;
    fetcher?:typeof fetch;signal?:AbortSignal;
  }>):Promise<Readonly<{
    identity:VantaFamilyBootstrapIdentity;pool:string;role:number;handle:string;handleId:string;
    ownerCommitment:string;authorizationCommitment:bigint;receiverCommitment:bigint;
    proofCommitment:bigint;routingCommitment:string;salt:string;deadline:bigint;actionDigest:bigint;
    authorizationNullifier:bigint;ownershipProof:readonly bigint[];to:string;calldata:string;
  }>>;
  signFamilyDepositQuoteAuthorization(input:Readonly<{networkId:string;generationId:string;asset:string;handleId:string;
    request:Readonly<Record<string,unknown>>;deadline?:number;requestNonce?:string}>):Promise<Readonly<{handleId:string;signerSalt:string;
    requestNonce:string;deadline:number;signature:string}>>;
  exportFamilyPartnerReceivingRoute:VantaFamilyPartnerWallet["exportFamilyPartnerReceivingRoute"];
  exportFamilyHandleBinding(input:{handle:string;releaseContext?:import('./family-network.mjs').FamilyReleaseContext}):Promise<Readonly<{authorizationCommitment:string;salt:string;ownerCommitment:string;recordCommitment:string}>>;
  exportFamilyBootstrapReceivingRoute(input:{identity:VantaFamilyBootstrapIdentity;credentialScope:unknown}):ReturnType<VantaFamilyPartnerWallet["exportFamilyPartnerReceivingRoute"]>;
  prepareFamilyPartnerHandleClaim:VantaFamilyPartnerWallet["prepareFamilyPartnerHandleClaim"];
  approveFamilyPartnerAssetConfiguration(input:{handle:string;visibleAssets:readonly string[];app?:import('./family-partner-app-config.mjs').PartnerApplication;revision:bigint;deadline:bigint;artifactBaseUrl:string;releaseContext?:import("./family-network.mjs").FamilyReleaseContext;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<import("./family-partner-app-config.mjs").PartnerAssetAuthorization>;
  approveFamilyPartnerAction:VantaFamilyPartnerWallet["approveFamilyPartnerAction"];
  dispose():void;
}
export declare const createVantaFreshPrivateWallet:()=>Promise<Readonly<{
  wallet:VantaFreshPrivateWallet;recoveryPhrase:string;
}>>;
export declare const restoreVantaFreshPrivateWallet:(phrase:string)=>
  Promise<VantaFreshPrivateWallet>;
