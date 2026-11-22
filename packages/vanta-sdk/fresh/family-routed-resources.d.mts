export interface FamilyExternalPin {readonly address:string;readonly codehash:string;}
export interface FamilyRoutedResources {
 readonly schema:'vanta-family-chikyu-routes-v1';readonly gateway:FamilyExternalPin&Readonly<{deploymentBlock:number}>;
 readonly sourceSelector:string;readonly nativePool:string;readonly usdcPool:string;readonly bnmPool:string;
 readonly usdc:string;readonly bnm:string;readonly muchFi:FamilyExternalPin;readonly ccip:FamilyExternalPin;readonly wrappedDoge:FamilyExternalPin;
 readonly maximumDeliveryFee:string;readonly destination:Readonly<{chainId:11155111;selector:string;genesisHash:string;rpcUrl:string;
  token:string;tokenCodehash:string;router:string;routerCodehash:string;offRamp:string;offRampCodehash:string}>;
}
export function validateFamilyRoutedResources(raw:unknown,release:unknown,pools:readonly unknown[]):Readonly<FamilyRoutedResources>;
