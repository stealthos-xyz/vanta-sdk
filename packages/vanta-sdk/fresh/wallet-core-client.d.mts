export const STEALTHOS_WALLET_CORE_ORIGIN:'https://wallet.stealthos.xyz';
export interface WalletCoreSelection {networkId:string;generationId:string;asset:'native'|'token'|`0x${string}`;}
export function connectStealthOSWalletCore():{
 connect():Promise<Readonly<{masterPublicKey:string;viewingPublicKey:string}>>;
 balance(selection:WalletCoreSelection):Promise<Readonly<{balanceAtomic:string;asset:string;assetDecimals:number}>>;
 withdraw(selection:WalletCoreSelection&{recipient:string;sourceEpoch?:number}):Promise<Readonly<{preparedId:string;transactionHash:string|null;phase:string}>>;
 status(selection:WalletCoreSelection&{preparedId:string;transactionHash?:string}):Promise<Readonly<{preparedId:string;transactionHash:string|null;phase:string}>>;
 close():void;
};
