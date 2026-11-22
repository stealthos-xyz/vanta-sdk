import type {JsonRpcProvider,Provider} from 'ethers';
export function canonicalFamilyProvider<T extends Provider>(provider:T):T;
export function createFamilyRpcProviders(primaryUrl:string,verificationUrl:string,chainId:number):{provider:JsonRpcProvider;verificationProvider:JsonRpcProvider;mode:'single-endpoint'|'independent'};
