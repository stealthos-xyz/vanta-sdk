import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {transform} from "esbuild";

// Model only the IndexedDB versionchange/key-cursor boundary. The actual SDK
// implementation is loaded, not a duplicated migration function.
const source=await readFile(new URL("../browser/encrypted-store.ts",import.meta.url),"utf8");
const {code}=await transform(source,{loader:"ts",format:"esm",target:"es2022"});
const {createFamilyWalletStoreBackend}=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
const scope="vanta-wallet-v1/test/0x"+"11".repeat(20);
function oldDatabase(records){
 let requestedVersion;
 const db={close(){},onversionchange:null};
 const factory={open(_name,version){
   requestedVersion=version;
   const opening={result:db,transaction:{objectStore(){return {
     openKeyCursor(){
       const cursor={result:null};
       const keys=[...records.keys()];
       const next=()=>queueMicrotask(()=>{
         if(!keys.length){cursor.result=null;cursor.onsuccess();queueMicrotask(()=>opening.onsuccess());return;}
         cursor.result={primaryKey:keys.shift(),continue:next};cursor.onsuccess();
       });
       next();return cursor;
     },
     delete(key){records.delete(key);return {};},
   };}}};
   queueMicrotask(()=>opening.onupgradeneeded({oldVersion:1}));
   return opening;
 }};
 return {factory,get version(){return requestedVersion;}};
}
test("wallet upgrade removes legacy device keys but preserves encrypted records",async()=>{
 const phrase=scope+"/privacy-recovery-phrase-v1";
 const ciphertext={ciphertext:"synthetic-encrypted-record"};
 const records=new Map([
   ["@device-key/"+scope,{schema:"stealthos-wallet-device-key-v1",key:"synthetic-old-key"}],
   ["@device-key/other-wallet",{key:"synthetic-old-key"}],
   ["@key/"+scope,{salt:"synthetic-salt"}],
   [phrase,ciphertext],
   ["@password-policy/"+scope,{required:false}],
 ]);
 const model=oldDatabase(records);
 const store=await createFamilyWalletStoreBackend({scope,indexedDB:model.factory,cryptoProvider:globalThis.crypto});
 assert.equal(model.version,2);
 assert.equal([...records.keys()].some(k=>k.startsWith("@device-key/")),false);
 assert.equal(records.get(phrase),ciphertext);
 assert.deepEqual(records.get("@key/"+scope),{salt:"synthetic-salt"});
 assert.deepEqual(await store.passwordSettings(),{requirePassword:true,canUnlockWithoutPassword:false});
 assert.equal(await store.unlockOnDevice(),false);
 assert.equal(await store.rememberIfAllowed(),false);
 await assert.rejects(store.setRequirePassword(false),/Password protection is required/);
 await store.setRequirePassword(true);
 store.close();
});

test("only marked public-payment namespaces retain legacy device keys; private wallets cannot open them",async()=>{
 const payment="vanta-host-v1/payment-"+"ab".repeat(32)+"/0x"+"22".repeat(20)+"/eip155:6281971/0x"+"33".repeat(32);
 const contaminated=payment.replace("ab".repeat(32),"cd".repeat(32));
 const missing=payment.replace("ab".repeat(32),"ef".repeat(32));
 const paymentKey={schema:"stealthos-wallet-device-key-v1",key:"synthetic-payment-key"};
 const records=new Map([
  ["@device-key/"+payment,paymentKey],
  [payment+"/public-payment-device-v1",{}],
  [payment+"/family-kzg-deposits-v1%2F0x"+"44".repeat(20),{}],
  ["@device-key/"+contaminated,{}],[contaminated+"/public-payment-device-v1",{}],
  [contaminated+"/privacy-recovery-phrase-v1",{}],["@device-key/"+missing,{}],
  ["@device-key/"+scope,{}],[scope+"/privacy-recovery-phrase-v1",{}]
 ]);
 const model=oldDatabase(records);
 const privateStore=await createFamilyWalletStoreBackend({scope,indexedDB:model.factory});
 assert.equal(records.get("@device-key/"+payment),paymentKey);
 for(const other of [scope,contaminated,missing])assert.equal(records.has("@device-key/"+other),false);
 await assert.rejects(privateStore.openPaymentJournal(),/locked or invalid/);
 await assert.rejects(createFamilyWalletStoreBackend({scope,paymentJournalOnly:true,indexedDB:model.factory}),/locked or invalid/);
 await assert.rejects(createFamilyWalletStoreBackend({scope:payment,indexedDB:model.factory}),/locked or invalid/);
 privateStore.close();
 const journal=await createFamilyWalletStoreBackend({scope:payment,paymentJournalOnly:true,indexedDB:oldDatabase(records).factory});
 await assert.rejects(journal.unlock("synthetic-password"),/locked or invalid/);
 await assert.rejects(journal.exportRecoveryBackup({}),/locked or invalid/);
 assert.equal(await journal.unlockOnDevice(),false);
 journal.close();
});
