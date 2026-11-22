/** Trusted device-side adapters. Never register these methods on a public
 * WebView, model, relayer, HTTP, analytics, or logging interface. */
import {getAddress,Mnemonic} from "ethers";

const WORD=/^0x[0-9a-f]{64}$/u;
const code=(value,message)=>Object.assign(new Error(message),{code:value});
const fail=()=>{throw code("HOST_STORAGE_INVALID","Invalid private storage record.");};
function copy(value){
  const text=JSON.stringify(value,(_key,item)=>{
    if(item===undefined||typeof item==="function"||typeof item==="symbol"||
       typeof item==="bigint"||typeof item==="number"&&!Number.isFinite(item))fail();
    return item;
  });
  if(typeof text!=="string"||text.length>16*1024*1024)fail();
  return JSON.parse(text);
}
export function vantaHostWalletStorageScope({accountId,address}={}){
  if(typeof accountId!=="string"||!accountId.length||accountId.length>256||
     accountId!==accountId.trim())
    throw code("HOST_SCOPE_INVALID","An account and owner are required for private wallet storage.");
  return "vanta-wallet-v1/"+encodeURIComponent(accountId)+"/"+getAddress(address).toLowerCase();
}
export function vantaHostStorageScope({accountId,address,networkId,generationId}={}){
  const walletScope=vantaHostWalletStorageScope({accountId,address});
  if(!/^eip155:[1-9][0-9]*$/u.test(networkId??"")||
     !Number.isSafeInteger(Number(networkId.slice(7)))||
     !WORD.test(generationId??"")||BigInt(generationId)===0n)
    throw code("HOST_SCOPE_INVALID","Account, network and generation storage scope required.");
  return walletScope.replace("vanta-wallet-v1/","vanta-host-v1/")+"/"+
    networkId+"/"+generationId;
}

/** Native CAS must be backed by one encrypted, durably committed database
 * transaction, shared by every process/worker using that namespace. Returning
 * true before commit/fsync is a host bug. An in-memory Map is test-only.
 * Callbacks must be synchronous and pure; CAS conflicts can repeat them.
 */
export function createVantaHostAtomicStore({host,scope,maxConflicts=8}={}){
  const prefix=vantaHostStorageScope(scope);
  return createAtomicStore({host,prefix,maxConflicts});
}
/** A private identity survives SDK/network upgrades. Spending journals remain
 * in the generation-scoped store above and are never combined or copied. */
export function createVantaHostWalletAtomicStore({host,scope,maxConflicts=8}={}){
  return createAtomicStore({host,prefix:vantaHostWalletStorageScope(scope),maxConflicts});
}
function createAtomicStore({host,prefix,maxConflicts}){
  if(!host||typeof host.read!=="function"||
     typeof host.compareAndSwap!=="function"||
     host.capabilities?.localOnly!==true||
     host.capabilities?.encryptedAtRest!==true||
     host.capabilities?.durableAtomicCompareAndSwap!==true||
     !Number.isSafeInteger(maxConflicts)||maxConflicts<0||maxConflicts>32)
    throw code("HOST_STORAGE_REQUIRED","Encrypted durable local atomic storage is required.");
  let closed=false,epoch=0;
  const live=(expected=epoch)=>{
    if(closed||epoch!==expected)throw code("HOST_STORAGE_LOCKED","Private storage is locked.");
  };
  const namespace=value=>{
    if(typeof value!=="string"||!value.length||value.length>512)
      throw code("HOST_STORAGE_INVALID","Invalid private storage namespace.");
    return prefix+"/"+encodeURIComponent(value);
  };
  const snapshot=value=>{
    if(!value||typeof value!=="object"||
       Object.keys(value).sort().join()!=="entries,revision"||
       typeof value.revision!=="string"||!value.revision.length||
       value.revision.length>128||!Array.isArray(value.entries))fail();
    return {revision:value.revision,entries:copy(value.entries)};
  };
  return Object.freeze({
    scope:prefix,
    async read(name){
      live();const started=epoch;
      const result=snapshot(await host.read(namespace(name)));live(started);
      return result.entries;
    },
    async transact(name,update){
      live();if(typeof update!=="function")fail();
      const started=epoch,key=namespace(name);
      for(let attempt=0;attempt<=maxConflicts;attempt++){
        const previous=snapshot(await host.read(key));live(started);
        const change=update(previous.entries);
        if(change&&typeof change.then==="function"){
          Promise.resolve(change).catch(()=>{});fail();
        }
        if(!change||
           !Array.isArray(change.next)||Object.keys(change).sort().join()!=="next,result")fail();
        const entries=copy(change.next);live(started);
        const result=await host.compareAndSwap({namespace:key,
          expectedRevision:previous.revision,entries});
        live(started);
        if(!result||typeof result.committed!=="boolean"||
           typeof result.revision!=="string"||!result.revision.length||
           result.revision.length>128||
           result.committed&&result.revision===previous.revision)fail();
        if(result.committed)return change.result;
      }
      throw code("HOST_STORAGE_CONFLICT","Concurrent wallet storage update; reconcile before retrying.");
    },
    close(){closed=true;epoch++;},
  });
}

/** Compatibility adapter for the existing fresh SDK vault contract. The
 * dedicated privacy phrase is never the MyDoge EVM seed. The native host owns
 * secure authentication and backup UI; only the trusted runtime reads it.
 */
export function createVantaHostPrivacyVault({store}={}){
  if(!store||typeof store.read!=="function"||typeof store.transact!=="function"||
     typeof store.scope!=="string"||!["vanta-host-v1/","vanta-wallet-v1/"].some(p=>store.scope.startsWith(p)))
    throw code("HOST_STORAGE_REQUIRED","An account-scoped encrypted native store is required.");
  const name="privacy-recovery-phrase-v1",pending="privacy-pending-v1";
  let pendingToken="[]";
  const pendingRows=rows=>{
    if(!Array.isArray(rows)||rows.length>1||
       rows[0]&&rows[0].schema!=="vanta-fresh-partner-pending-v1")fail();
    return JSON.stringify(rows);
  };
  const phrase=value=>{
    if(typeof value!=="string"||value.length>256||
       value!==value.trim().toLowerCase().replace(/\s+/gu," ")||
       value.split(" ").length!==12||!Mnemonic.isValidMnemonic(value))
      throw code("HOST_PHRASE_INVALID","A valid dedicated twelve-word privacy recovery phrase is required.");
    return value;
  };
  const record=rows=>{
    if(!Array.isArray(rows)||rows.length>1)fail();
    if(!rows.length)return null;
    if(Object.keys(rows[0]??{}).sort().join()!=="phrase,schema"||
       rows[0].schema!=="vanta-host-privacy-phrase-v1")fail();
    return phrase(rows[0].phrase);
  };
  const readPhrase=async()=>record(await store.read(name));
  return Object.freeze({
    hasRecoveryPhrase:async()=>await readPhrase()!==null,
    async saveRecoveryPhraseLocally(value){
      phrase(value);
      await store.transact(name,rows=>{
        if(record(rows)!==null)throw code("HOST_WALLET_EXISTS","Private wallet already exists for this account.");
        return {next:[{schema:"vanta-host-privacy-phrase-v1",phrase:value}],result:undefined};
      });
      if(await readPhrase()!==value)
        throw code("HOST_STORAGE_INVALID","Private wallet backup readback failed.");
    },
    async loadRecoveryPhraseLocally(){
      const value=await readPhrase();
      if(value===null)throw code("HOST_WALLET_MISSING","Restore or create this account's private wallet.");
      return value;
    },
    async savePendingLocally(value){
      if(value?.schema!=="vanta-fresh-partner-pending-v1"||
         JSON.stringify(value).length>32768)fail();
      const entry=copy(value),expected=pendingToken;
      await store.transact(pending,rows=>{
        if(pendingRows(rows)!==expected)
          throw code("HOST_STORAGE_CONFLICT","Reconcile the current pending operation before replacing it.");
        return {next:[entry],result:undefined};
      });
      pendingToken=JSON.stringify([entry]);
    },
    async loadPendingLocally(){
      const rows=await store.read(pending);
      pendingToken=pendingRows(rows);
      return rows[0]??null;
    },
    async clearPendingLocally(){
      const expected=pendingToken;
      await store.transact(pending,rows=>{
        if(pendingRows(rows)!==expected)
          throw code("HOST_STORAGE_CONFLICT","Pending operation changed before reconciliation completed.");
        return {next:[],result:undefined};
      });
      pendingToken="[]";
    },
  });
}

/** Run only inside the trusted local runtime. Native UI requests creation,
 * unlock, backup and restore by command; phrase values never enter those
 * command payloads or results. Call lock synchronously on all lifecycle
 * invalidations. Build a new controller/store for each account/generation.
 */
export function createVantaLocalPrivacyWallet({vault,ui}={}){
  if(!vault||["hasRecoveryPhrase","saveRecoveryPhraseLocally",
    "loadRecoveryPhraseLocally"].some(key=>typeof vault[key]!=="function")||
     !ui||["authenticate","confirmBackup","requestRestorePhrase"]
       .some(key=>typeof ui[key]!=="function"))
    throw code("HOST_VAULT_REQUIRED","Trusted local vault and native secret UI are required.");
  let wallet=null,revision=0,busy=false;
  const assertCurrent=expected=>{
    if(expected!==revision)throw code("HOST_WALLET_LOCKED","Private wallet context changed.");
  };
  async function run(action){
    if(busy)throw code("HOST_WALLET_BUSY","A private wallet action is already pending.");
    busy=true;const started=revision;
    try{
      if(await ui.authenticate()!==true)
        throw code("HOST_UNLOCK_REJECTED","Local wallet unlock was declined.");
      assertCurrent(started);return await action(started);
    }finally{busy=false;}
  }
  const ready=()=>Object.freeze({walletReady:wallet!==null});
  return Object.freeze({
    create:()=>run(async started=>{
      if(await vault.hasRecoveryPhrase())throw code("HOST_WALLET_EXISTS","Private wallet already exists.");
      assertCurrent(started);
      const {createVantaFreshPrivateWallet}=await import("./wallet-runtime.mjs");
      assertCurrent(started);
      const created=await createVantaFreshPrivateWallet();
      try{
        assertCurrent(started);
        if(await ui.confirmBackup(created.recoveryPhrase)!==true)
          throw code("HOST_BACKUP_REJECTED","Privacy recovery backup was not confirmed.");
        assertCurrent(started);
        await vault.saveRecoveryPhraseLocally(created.recoveryPhrase);assertCurrent(started);
        wallet?.dispose();wallet=created.wallet;return ready();
      }catch(error){created.wallet.dispose();throw error;}
    }),
    unlock:()=>run(async started=>{
      const phrase=await vault.loadRecoveryPhraseLocally();assertCurrent(started);
      const {restoreVantaFreshPrivateWallet}=await import("./wallet-runtime.mjs");
      assertCurrent(started);const restored=await restoreVantaFreshPrivateWallet(phrase);
      try{assertCurrent(started);wallet?.dispose();wallet=restored;return ready();}
      catch(error){restored.dispose();throw error;}
    }),
    restore:()=>run(async started=>{
      if(await vault.hasRecoveryPhrase())throw code("HOST_WALLET_EXISTS","Private wallet already exists.");
      assertCurrent(started);
      const phrase=await ui.requestRestorePhrase();assertCurrent(started);
      const {restoreVantaFreshPrivateWallet}=await import("./wallet-runtime.mjs");
      assertCurrent(started);const restored=await restoreVantaFreshPrivateWallet(phrase);
      try{
        assertCurrent(started);await vault.saveRecoveryPhraseLocally(phrase);assertCurrent(started);
        wallet?.dispose();wallet=restored;return ready();
      }catch(error){restored.dispose();throw error;}
    }),
    backup:()=>run(async started=>{
      const phrase=await vault.loadRecoveryPhraseLocally();assertCurrent(started);
      const confirmed=await ui.confirmBackup(phrase);assertCurrent(started);
      return Object.freeze({backupConfirmed:confirmed===true});
    }),
    /** Trusted SDK composition only; never export this over the UI bridge. */
    requireWallet(){
      if(!wallet)throw code("HOST_WALLET_LOCKED","Unlock the private wallet first.");
      return wallet;
    },
    status:ready,
    lock(){revision++;wallet?.dispose();wallet=null;},
  });
}
