import type {FamilySdkRelease} from './family-network.mjs';
import type {Provider} from 'ethers';
import type {VantaFamilyPartnerWallet} from './family-partner-registry.mjs';
export function normalizeVantaFamilyHandle(handle:string):string;
export function parseCustomerHandleCalldata(data:string,release:FamilySdkRelease):Promise<{schema:string;route:{handle:string;[name:string]:unknown};binding:Record<string,string>}>;
export function customerHandleId(handle:string,chainId:number):Promise<string>;
export function validateCustomerHandleOpening(record:unknown,release:FamilySdkRelease):Promise<unknown>;
export function customerHandleCalldata(claim:Record<string,unknown>,record:unknown):string;
export interface CustomerHandle {readonly handle:string;readonly phase:'prepared'|'submitting'|'submitted'|'confirmed';readonly transactionHash:string|null;}
export interface CustomerHandlesOptions {
 walletController:{requireWallet():VantaFamilyPartnerWallet & Pick<import('./wallet-runtime.mjs').VantaFreshPrivateWallet,'exportFamilyHandleBinding'>};
 store:{read(namespace:string):Promise<unknown[]>;transact(namespace:string,work:(rows:unknown[])=>{next:unknown[];result:unknown}):Promise<unknown>};
 provider:Provider;verificationProvider:Provider;artifactBaseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;
 submitTransaction(request:{chainId:number;to:string;data:string;value:string;transactionDigest:string;handle:string}):Promise<string>;
 reconcileTransaction?(request:{chainId:number;to:string;data:string;value:string;transactionDigest:string;handle:string}):Promise<string|null>;
}
export function createFamilyCustomerHandles(options:CustomerHandlesOptions):Promise<{available(handle:string):Promise<{available:boolean;handle:string}>;current(hints?:readonly string[]):Promise<CustomerHandle|null>;claim(handle:string):Promise<CustomerHandle>;check():Promise<CustomerHandle|null>;find(handle:string):Promise<CustomerHandle>;resolve(handle:string,asset:string):Promise<import('./family-normal-host.mjs').FamilyNoteRecipient>}>;
