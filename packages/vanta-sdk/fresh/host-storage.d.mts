export interface VantaHostStorageIdentity {
  accountId:string;address:string;networkId:string;generationId:string;
}
export interface VantaHostStorageBackend {
  capabilities:{localOnly:true;encryptedAtRest:true;durableAtomicCompareAndSwap:true};
  read(namespace:string):Promise<{revision:string;entries:unknown[]}>;
  compareAndSwap(input:{namespace:string;expectedRevision:string;entries:unknown[]}):
    Promise<{committed:boolean;revision:string}>;
}
export interface VantaHostAtomicStore {
  readonly scope:string;read(namespace:string):Promise<unknown[]>;
  transact<T>(namespace:string,update:(entries:unknown[])=>{next:unknown[];result:T}):Promise<T>;
  close():void;
}
export function vantaHostStorageScope(scope:VantaHostStorageIdentity):string;
export function vantaHostWalletStorageScope(scope:Pick<VantaHostStorageIdentity,"accountId"|"address">):string;
export function createVantaHostWalletAtomicStore(input:{host:VantaHostStorageBackend;
  scope:Pick<VantaHostStorageIdentity,"accountId"|"address">;maxConflicts?:number}):VantaHostAtomicStore;
export function createVantaHostAtomicStore(input:{host:VantaHostStorageBackend;
  scope:VantaHostStorageIdentity;maxConflicts?:number}):VantaHostAtomicStore;
export interface VantaHostPrivacyVault {
  hasRecoveryPhrase():Promise<boolean>;saveRecoveryPhraseLocally(phrase:string):Promise<void>;
  loadRecoveryPhraseLocally():Promise<string>;savePendingLocally(value:unknown):Promise<void>;
  loadPendingLocally():Promise<unknown|null>;clearPendingLocally():Promise<void>;
}
export function createVantaHostPrivacyVault(input:{store:VantaHostAtomicStore}):VantaHostPrivacyVault;
export interface VantaTrustedSecretUi {
  authenticate():Promise<boolean>;confirmBackup(phrase:string):Promise<boolean>;
  requestRestorePhrase():Promise<string>;
}
export function createVantaLocalPrivacyWallet(input:{vault:VantaHostPrivacyVault;ui:VantaTrustedSecretUi}):{
  create():Promise<Readonly<{walletReady:boolean}>>;unlock():Promise<Readonly<{walletReady:boolean}>>;
  restore():Promise<Readonly<{walletReady:boolean}>>;backup():Promise<Readonly<{backupConfirmed:boolean}>>;
  requireWallet():import("./wallet-runtime.mjs").VantaFreshPrivateWallet;
  status():Readonly<{walletReady:boolean}>;lock():void;
};
