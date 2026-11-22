export interface VantaHostWalletContext {
  readonly address:string;readonly chainId:number;readonly networkId:string;readonly revision:number;
}
export interface VantaPublicTransaction {
  to:string;from?:string;chainId?:string|number;value?:string;data?:string;
  gas?:string;gasPrice?:string;maxFeePerGas?:string;maxPriorityFeePerGas?:string;
  nonce?:string;type?:string;accessList?:{address:string;storageKeys:string[]}[];
}
export interface VantaHostWallet {
  getContext():Promise<VantaHostWalletContext>;
  personalSign(input:{message:string;context:VantaHostWalletContext}):Promise<string>;
  sendTransaction(input:{transaction:VantaPublicTransaction;context:VantaHostWalletContext;
    onSubmitted?:(hash:string)=>Promise<void>|void}):Promise<string>;
  subscribe(listener:(reason:string)=>void):()=>void;
  invalidate(reason?:string):void;dispose():void;
}
export interface VantaEip1193Provider {
  request(input:{method:string;params?:unknown[]}):Promise<unknown>;
  on?(event:string,listener:()=>void):void;
  removeListener?(event:string,listener:()=>void):void;
}
export function createEip1193HostWallet(input:{provider:VantaEip1193Provider;
  onInvalidated?:(reason:string)=>void;
  /** Set only when the host guarantees code 4001 means nothing was submitted. */
  transactionRejectionIsDefinitive?:boolean}):VantaHostWallet;
export interface VantaNativeAccount {
  accountId:string;address:string;chainId:number;revision:number;locked:false;
}
export interface VantaNativeWalletHost {
  capabilities?:{transactionRejectionIsDefinitive?:boolean};
  getActiveAccount():Promise<VantaNativeAccount|null>;
  approvePersonalSign(input:{context:VantaNativeAccount;messageHex:string;address:string}):Promise<string>;
  approveTransaction(input:{context:VantaNativeAccount;transaction:VantaPublicTransaction}):Promise<string>;
  subscribe(listener:()=>void):()=>void;
}
export function createNativeHostWallet(input:{host:VantaNativeWalletHost;
  onInvalidated?:(reason:string)=>void}):VantaHostWallet;
