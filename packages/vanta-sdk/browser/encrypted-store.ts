/** Browser implementation of the SDK's existing encrypted, atomic host store.
 * Other wallets use separate databases and are never read or migrated. */
import type {VantaHostStorageBackend} from "@stealthos/vanta-sdk/host-storage";

const DATABASE = "stealthos-vanta-family-host-v1", TABLE = "ciphertexts";
const SCHEMA = "vanta-family-browser-store-v1", ITERATIONS = 600_000;
const MAX_BYTES = 16 * 1024 * 1024;
/** Restore accepts ciphertext only. Decryption remains in the trusted worker. */
export async function decryptFamilyWalletRecoveryBackup({backup,password,cryptoProvider=globalThis.crypto}:{backup:unknown;password:string;cryptoProvider?:Crypto}):Promise<string>{
 const fail=():never=>{throw Error("The encrypted recovery backup or its password is invalid.");};
 const v=backup as {schema:string;scope:string;iterations:number;salt:string;iv:string;ciphertext:string};
 if(!v||Object.keys(v).sort().join()!=="ciphertext,iterations,iv,salt,schema,scope"||v.schema!=="stealthos-private-wallet-backup-v1"||
  !/^vanta-wallet-v1\/[^/]+\/0x[0-9a-f]{40}$/u.test(v.scope)||v.scope.length>1024||v.iterations!==ITERATIONS||
  !/^[0-9a-f]{64}$/u.test(v.salt)||!/^[0-9a-f]{24}$/u.test(v.iv)||!/^(?:[0-9a-f]{2}){16,4096}$/u.test(v.ciphertext)||
  typeof password!=="string"||password.length<8||password.length>1024)fail();
 const bytes=(s:string)=>Uint8Array.from(s.match(/../gu)!,b=>parseInt(b,16)),pw=new TextEncoder().encode(password);let plain:Uint8Array|undefined;
 try{
  const material=await cryptoProvider.subtle.importKey("raw",pw,"PBKDF2",false,["deriveKey"]),
   key=await cryptoProvider.subtle.deriveKey({name:"PBKDF2",salt:bytes(v.salt),iterations:ITERATIONS,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["decrypt"]);
  plain=new Uint8Array(await cryptoProvider.subtle.decrypt({name:"AES-GCM",iv:bytes(v.iv),additionalData:new TextEncoder().encode(
   JSON.stringify([SCHEMA,v.scope,"@recovery-backup/v1","0"]))},key,bytes(v.ciphertext)));
  const record=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(plain));
  if(Object.keys(record).sort().join()!=="phrase,schema"||record.schema!=="vanta-host-privacy-phrase-v1"||typeof record.phrase!=="string"||record.phrase.length>256)fail();
  return record.phrase;
 }catch{return fail();}finally{pw.fill(0);plain?.fill(0);}
}
type Envelope = {schema: typeof SCHEMA; revision: string; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer};
type KeyRecord = Envelope & {salt: Uint8Array<ArrayBuffer>; iterations: typeof ITERATIONS};
function fail(): never {throw Error("The encrypted private wallet store is locked or invalid.");}
const request = <T,>(input: IDBRequest<T>) => new Promise<T>((accept, reject) => {
  input.onsuccess = () => accept(input.result);
  input.onerror = () => reject(input.error ?? Error("Private storage request failed."));
});

export async function createFamilyWalletStoreBackend({scope, indexedDB: factory = globalThis.indexedDB,
  cryptoProvider = globalThis.crypto}: {scope: string; indexedDB?: IDBFactory; cryptoProvider?: Crypto}) {
  if (!/^(?:vanta-wallet-v1\/[^/]+\/0x[0-9a-f]{40}|vanta-host-v1\/[^/]+\/0x[0-9a-f]{40}\/eip155:[1-9][0-9]*\/0x[0-9a-f]{64})$/u.test(scope) ||
      scope.length > 1024 || !factory || !cryptoProvider?.subtle) fail();
  const opening = factory.open(DATABASE, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(TABLE);
  const database = await new Promise<IDBDatabase>((accept, reject) => {
    opening.onsuccess = () => accept(opening.result);
    opening.onerror = () => reject(opening.error ?? Error("Private storage could not open."));
    opening.onblocked = () => reject(Error("Close the other wallet tab before upgrading private storage."));
  });
  let key: CryptoKey | null = null, keyRecord: KeyRecord | null = null, newKey = false, closed = false, epoch = 0;
  const pending = new Set<IDBTransaction>(), keyName = "@key/" + scope, deviceName="@device-key/"+scope, policyName="@password-policy/"+scope;
  const live = (revision = epoch) => {if (closed || revision !== epoch) fail();};
  const locked = () => {live(); if (!key) fail(); return key;};
  const namespace = (value: string) => {
    if (typeof value !== "string" || !value.startsWith(scope + "/") || value.length > scope.length + 8192) fail();
    return value;
  };
  const aad = (name: string, revision: string) => new TextEncoder().encode(JSON.stringify([SCHEMA, scope, name, revision]));
  const transaction = (mode: IDBTransactionMode) => {
    live(); const tx = database.transaction(TABLE, mode, mode === "readwrite" ? {durability: "strict"} : undefined);
    pending.add(tx);
    const done = new Promise<void>((accept, reject) => {
      tx.oncomplete = () => {pending.delete(tx); accept();};
      tx.onabort = tx.onerror = () => {pending.delete(tx); reject(tx.error ?? Error("Private storage transaction failed."));};
    });
    // The request can fail before its transaction event; keep both observed.
    void done.catch(() => {});
    return {tx, table: tx.objectStore(TABLE), done};
  };
  const get = async (name: string) => {
    const {table, done} = transaction("readonly");
    const value = await request(table.get(name)); await done; return value;
  };
  const envelope = (value: unknown): Envelope => {
    const v = value as Envelope;
    if (!v || v.schema !== SCHEMA || !/^(0|[1-9][0-9]{0,38})$/u.test(v.revision) ||
        !(v.iv instanceof Uint8Array) || v.iv.length !== 12 || !(v.ciphertext instanceof ArrayBuffer) ||
        v.ciphertext.byteLength < 16 || v.ciphertext.byteLength > MAX_BYTES + 16) fail();
    return v;
  };
  const sameKeyRecord = (value: unknown, expected: KeyRecord) => {
    const actual = value as KeyRecord; envelope(actual);
    if (actual.iterations !== ITERATIONS || !(actual.salt instanceof Uint8Array) || actual.salt.length !== 32) fail();
    return actual.revision === expected.revision &&
      [actual.salt, actual.iv, new Uint8Array(actual.ciphertext)].every((bytes, i) => {
        const other = [expected.salt, expected.iv, new Uint8Array(expected.ciphertext)][i];
        return bytes.length === other.length && bytes.every((b, j) => b === other[j]);
      });
  };
  const derive = async (password: string, salt: Uint8Array<ArrayBuffer>) => {
    if (typeof password !== "string" || password.length < 8 || password.length > 1024) fail();
    const bytes = new TextEncoder().encode(password);
    try {
      const material = await cryptoProvider.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
      return await cryptoProvider.subtle.deriveKey({name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256"},
        material, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
    } finally {bytes.fill(0);}
  };
  const seal = async (key: CryptoKey, name: string, revision: string, value: unknown): Promise<Envelope> => {
    const plain = new TextEncoder().encode(JSON.stringify(value));
    if (plain.length > MAX_BYTES) {plain.fill(0); fail();}
    const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
    try {return {schema: SCHEMA, revision, iv, ciphertext: await cryptoProvider.subtle.encrypt(
      {name: "AES-GCM", iv, additionalData: aad(name, revision)}, key, plain)};}
    finally {plain.fill(0);}
  };
  const open = async (key: CryptoKey, name: string, value: unknown) => {
    const sealed = envelope(value); let plain: Uint8Array<ArrayBuffer>;
    try {plain = new Uint8Array(await cryptoProvider.subtle.decrypt(
      {name: "AES-GCM", iv: sealed.iv, additionalData: aad(name, sealed.revision)}, key, sealed.ciphertext));}
    catch {fail();}
    try {return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(plain));}
    finally {plain.fill(0);}
  };
  const lock = () => {
    epoch++; key = null; keyRecord = null; newKey = false;
    for (const tx of pending) {try {tx.abort();} catch {/* Already committed. */}}
  };
  const close = () => {if (!closed) {lock(); closed = true; database.close();}};
  database.onversionchange = close;
  type DeviceKey={schema:'stealthos-wallet-device-key-v1';key:CryptoKey;record:KeyRecord};
  const requiresPassword=(policy:unknown)=>{if(policy===undefined)return false;const p=policy as {schema:string;required:boolean};if(!p||p.schema!=='stealthos-wallet-password-policy-v1'||typeof p.required!=='boolean')fail();return p.required;};
  const deviceKey=(value:unknown,record:unknown):DeviceKey|null=>{const d=value as DeviceKey;if(!d||d.schema!=='stealthos-wallet-device-key-v1'||!d.key||d.key.type!=='secret'||d.key.extractable!==false||d.key.algorithm.name!=='AES-GCM'||(d.key.algorithm as AesKeyAlgorithm).length!==256||d.key.usages.slice().sort().join()!=='decrypt,encrypt')return null;try{return sameKeyRecord(record,d.record)?d:null;}catch{return null;}};
  const savedUnlock=async()=>{const {table,done}=transaction('readonly');const [policy,record,device]=await Promise.all([request(table.get(policyName)),request(table.get(keyName)),request(table.get(deviceName))]);await done;return {required:requiresPassword(policy),record,device:record?deviceKey(device,record):null};};
  const persistDevice=async(required:boolean|undefined)=>{const current=locked(),started=epoch,metadata=keyRecord;if(!metadata||newKey)fail();const {table,tx,done}=transaction('readwrite');try{const [policy,record]=await Promise.all([request(table.get(policyName)),request(table.get(keyName))]);live(started);if(!sameKeyRecord(record,metadata))fail();const requirePassword=required??requiresPassword(policy);if(required!==undefined)await request(table.put({schema:'stealthos-wallet-password-policy-v1',required},policyName));if(requirePassword)await request(table.delete(deviceName));else await request(table.put({schema:'stealthos-wallet-device-key-v1',key:current,record:metadata} satisfies DeviceKey,deviceName));await done;live(started);return !requirePassword;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}};
  const backend: VantaHostStorageBackend & {
    unlock(password: string): Promise<void>; hasRecoveryPhrase(): Promise<boolean>; lock(): void; close(): void;
    scoped(operationScope:string):VantaHostStorageBackend;
    passwordSettings():Promise<{requirePassword:boolean;canUnlockWithoutPassword:boolean}>;
    unlockOnDevice():Promise<boolean>;rememberIfAllowed():Promise<boolean>;setRequirePassword(required:boolean):Promise<void>;
    exportRecoveryBackup(record:unknown):Promise<unknown>;
  } = {
    capabilities: {localOnly: true, encryptedAtRest: true, durableAtomicCompareAndSwap: true},
    async passwordSettings(){live();const saved=await savedUnlock();return {requirePassword:saved.required,canUnlockWithoutPassword:!saved.required&&Boolean(saved.device)};},
    async unlockOnDevice(){live();lock();const started=epoch,saved=await savedUnlock();live(started);if(saved.required||!saved.device)return false;const marker=await open(saved.device.key,keyName,saved.record);live(started);if(JSON.stringify(marker)!==JSON.stringify({scope}))fail();const current=await savedUnlock();live(started);if(current.required||!current.device||!sameKeyRecord(current.record,saved.device.record))return false;key=saved.device.key;keyRecord=saved.device.record;return true;},
    rememberIfAllowed:()=>persistDevice(undefined),
    async setRequirePassword(required){if(typeof required!=='boolean')fail();await persistDevice(required);},
    async unlock(password) {
      live(); lock(); const started = epoch;
      const record = await get(keyName) as KeyRecord | undefined; live(started);
      if (record === undefined) {
        const salt = cryptoProvider.getRandomValues(new Uint8Array(32)), candidate = await derive(password, salt);
        const created: KeyRecord = {...await seal(candidate, keyName, "0", {scope}), salt, iterations: ITERATIONS};
        live(started); key = candidate; keyRecord = created; newKey = true; return;
      }
      live(started);
      if (!record || record.iterations !== ITERATIONS || !(record.salt instanceof Uint8Array) || record.salt.length !== 32) fail();
      const opened = await derive(password, record.salt), marker = await open(opened, keyName, record);
      live(started); if (JSON.stringify(marker) !== JSON.stringify({scope})) fail(); key = opened; keyRecord = record;
    },
    async hasRecoveryPhrase() {live(); return await get(scope + "/privacy-recovery-phrase-v1") !== undefined;},
    async read(name) {
      const current = locked(), started = epoch; namespace(name);
      const sealed = await get(name); live(started);
      if (sealed === undefined) return {revision: "0", entries: []};
      const entries = await open(current, name, sealed); live(started);
      if (!Array.isArray(entries)) fail(); return {revision: envelope(sealed).revision, entries};
    },
    async compareAndSwap({namespace: name, expectedRevision, entries}) {
      const current = locked(), started = epoch; namespace(name);
      const metadata = keyRecord; if (!metadata) fail();
      if (!/^(0|[1-9][0-9]{0,37})$/u.test(expectedRevision) || !Array.isArray(entries)) fail();
      const revision = (BigInt(expectedRevision) + 1n).toString(), sealed = await seal(current, name, revision, entries);
      live(started); const {table, tx, done} = transaction("readwrite");
      try {
        const storedKey = await request(table.get(keyName));
        if (storedKey === undefined ? !newKey : !sameKeyRecord(storedKey, metadata)) fail();
        const previous = await request(table.get(name)), actual = previous === undefined ? "0" : envelope(previous).revision;
        live(started);
        if (actual !== expectedRevision) {await done; return {committed: false, revision: actual};}
        // A canceled first backup leaves no password record. Both the key and
        // its first encrypted record become durable in this one transaction.
        if (storedKey === undefined) await request(table.put(metadata, keyName));
        await request(table.put(sealed, name)); await done; live(started); newKey = false; return {committed: true, revision};
      } catch (error) {try {tx.abort();} catch {} await done.catch(() => {}); throw error;}
    },
    async exportRecoveryBackup(record) {
      const current=locked(),started=epoch,metadata=keyRecord;if(!metadata)fail();
      const sealed=await seal(current,"@recovery-backup/v1","0",record);live(started);
      const hex=(data:Uint8Array)=>Array.from(data,b=>b.toString(16).padStart(2,"0")).join("");
      return {schema:"stealthos-private-wallet-backup-v1",scope,iterations:ITERATIONS,salt:hex(metadata.salt),
        iv:hex(sealed.iv),ciphertext:hex(new Uint8Array(sealed.ciphertext))};
    },
    scoped(operationScope) {
      const ownerScope=scope.replace(/^vanta-wallet-v1\//u,"vanta-host-v1/");
      if(!scope.startsWith("vanta-wallet-v1/")||!operationScope.startsWith(ownerScope+"/")||
        !/^eip155:[1-9][0-9]*\/0x[0-9a-f]{64}$/u.test(operationScope.slice(ownerScope.length+1)))fail();
      // One unlocked, non-exportable key; AAD still authenticates the original
      // network/generation and every logical journal namespace independently.
      const map=(name:string)=>{
        if(!name.startsWith(operationScope+"/"))fail();
        return scope+"/generation/"+encodeURIComponent(name);
      };
      return Object.freeze({capabilities:backend.capabilities,
        read:(name:string)=>backend.read(map(name)),
        compareAndSwap:(input:Parameters<VantaHostStorageBackend["compareAndSwap"]>[0])=>
          backend.compareAndSwap({...input,namespace:map(input.namespace)})});
    },
    lock, close,
  };
  return Object.freeze(backend);
}
