import type {Provider} from 'ethers';
export interface PartnerApplication {name:string;origins:readonly string[];authorizationUrl?:string;}
export interface PartnerAssetConfiguration {schema:'stealthos-partner-app-assets-v1'|'stealthos-partner-app-assets-v2';app?:PartnerApplication;networkId:string;setupId:string;generationId:string;genesisHash:string;
 registrar:string;handle:string;handleId:string;visibleAssets:readonly string[];revision:string;deadline:number;}
export interface PartnerAssetAuthorization {configuration:PartnerAssetConfiguration;ownerCommitment:string;authorizationCommitment:string;
 actionDigest:string;authorizationNullifier:string;ownershipProof:readonly string[];}
export function verifyVantaFamilyPartnerAssetConfiguration(options:{authorization:PartnerAssetAuthorization;provider:Provider;verificationProvider:Provider;
 allowExpired?:boolean;releaseContext?:import('./family-network.mjs').FamilyReleaseContext}):Promise<Readonly<PartnerAssetConfiguration&{verifiedOnChain:true}>>;
export function createVantaFamilyPartnerAssetConfiguration(options:{provider:Provider;verificationProvider:Provider;url:string;handleId:string;releaseContext?:import('./family-network.mjs').FamilyReleaseContext;fetcher?:typeof fetch;
 onChange?:(config:Readonly<PartnerAssetConfiguration>)=>void}):Readonly<{
 refresh():Promise<Readonly<PartnerAssetConfiguration>>;current():Readonly<PartnerAssetConfiguration>|undefined;
 requireAsset(asset:string,input?:{operation?:string}):true;
}>;
