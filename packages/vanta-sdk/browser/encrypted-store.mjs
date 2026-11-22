// browser/encrypted-store.ts
var DATABASE = "stealthos-vanta-family-host-v1";
var TABLE = "ciphertexts";
var SCHEMA = "vanta-family-browser-store-v1";
var ITERATIONS = 6e5;
var MAX_BYTES = 16 * 1024 * 1024;
async function decryptFamilyWalletRecoveryBackup({ backup, password, cryptoProvider = globalThis.crypto }) {
  const fail2 = () => {
    throw Error("The encrypted recovery backup or its password is invalid.");
  };
  const v = backup;
  if (!v || Object.keys(v).sort().join() !== "ciphertext,iterations,iv,salt,schema,scope" || v.schema !== "stealthos-private-wallet-backup-v1" || !/^vanta-wallet-v1\/[^/]+\/0x[0-9a-f]{40}$/u.test(v.scope) || v.scope.length > 1024 || v.iterations !== ITERATIONS || !/^[0-9a-f]{64}$/u.test(v.salt) || !/^[0-9a-f]{24}$/u.test(v.iv) || !/^(?:[0-9a-f]{2}){16,4096}$/u.test(v.ciphertext) || typeof password !== "string" || password.length < 8 || password.length > 1024) fail2();
  const bytes = (s) => Uint8Array.from(s.match(/../gu), (b) => parseInt(b, 16)), pw = new TextEncoder().encode(password);
  let plain;
  try {
    const material = await cryptoProvider.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveKey"]), key = await cryptoProvider.subtle.deriveKey({ name: "PBKDF2", salt: bytes(v.salt), iterations: ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    plain = new Uint8Array(await cryptoProvider.subtle.decrypt({ name: "AES-GCM", iv: bytes(v.iv), additionalData: new TextEncoder().encode(
      JSON.stringify([SCHEMA, v.scope, "@recovery-backup/v1", "0"])
    ) }, key, bytes(v.ciphertext)));
    const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    if (Object.keys(record).sort().join() !== "phrase,schema" || record.schema !== "vanta-host-privacy-phrase-v1" || typeof record.phrase !== "string" || record.phrase.length > 256) fail2();
    return record.phrase;
  } catch {
    return fail2();
  } finally {
    pw.fill(0);
    plain?.fill(0);
  }
}
function fail() {
  throw Error("The encrypted private wallet store is locked or invalid.");
}
var request = (input) => new Promise((accept, reject) => {
  input.onsuccess = () => accept(input.result);
  input.onerror = () => reject(input.error ?? Error("Private storage request failed."));
});
async function createFamilyWalletStoreBackend({
  scope,
  indexedDB: factory = globalThis.indexedDB,
  cryptoProvider = globalThis.crypto
}) {
  if (!/^(?:vanta-wallet-v1\/[^/]+\/0x[0-9a-f]{40}|vanta-host-v1\/[^/]+\/0x[0-9a-f]{40}\/eip155:[1-9][0-9]*\/0x[0-9a-f]{64})$/u.test(scope) || scope.length > 1024 || !factory || !cryptoProvider?.subtle) fail();
  const opening = factory.open(DATABASE, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(TABLE);
  const database = await new Promise((accept, reject) => {
    opening.onsuccess = () => accept(opening.result);
    opening.onerror = () => reject(opening.error ?? Error("Private storage could not open."));
    opening.onblocked = () => reject(Error("Close the other wallet tab before upgrading private storage."));
  });
  let key = null, keyRecord = null, newKey = false, closed = false, epoch = 0;
  const pending = /* @__PURE__ */ new Set(), keyName = "@key/" + scope, deviceName = "@device-key/" + scope, policyName = "@password-policy/" + scope;
  const live = (revision = epoch) => {
    if (closed || revision !== epoch) fail();
  };
  const locked = () => {
    live();
    if (!key) fail();
    return key;
  };
  const namespace = (value) => {
    if (typeof value !== "string" || !value.startsWith(scope + "/") || value.length > scope.length + 8192) fail();
    return value;
  };
  const aad = (name, revision) => new TextEncoder().encode(JSON.stringify([SCHEMA, scope, name, revision]));
  const transaction = (mode) => {
    live();
    const tx = database.transaction(TABLE, mode, mode === "readwrite" ? { durability: "strict" } : void 0);
    pending.add(tx);
    const done = new Promise((accept, reject) => {
      tx.oncomplete = () => {
        pending.delete(tx);
        accept();
      };
      tx.onabort = tx.onerror = () => {
        pending.delete(tx);
        reject(tx.error ?? Error("Private storage transaction failed."));
      };
    });
    void done.catch(() => {
    });
    return { tx, table: tx.objectStore(TABLE), done };
  };
  const get = async (name) => {
    const { table, done } = transaction("readonly");
    const value = await request(table.get(name));
    await done;
    return value;
  };
  const envelope = (value) => {
    const v = value;
    if (!v || v.schema !== SCHEMA || !/^(0|[1-9][0-9]{0,38})$/u.test(v.revision) || !(v.iv instanceof Uint8Array) || v.iv.length !== 12 || !(v.ciphertext instanceof ArrayBuffer) || v.ciphertext.byteLength < 16 || v.ciphertext.byteLength > MAX_BYTES + 16) fail();
    return v;
  };
  const sameKeyRecord = (value, expected) => {
    const actual = value;
    envelope(actual);
    if (actual.iterations !== ITERATIONS || !(actual.salt instanceof Uint8Array) || actual.salt.length !== 32) fail();
    return actual.revision === expected.revision && [actual.salt, actual.iv, new Uint8Array(actual.ciphertext)].every((bytes, i) => {
      const other = [expected.salt, expected.iv, new Uint8Array(expected.ciphertext)][i];
      return bytes.length === other.length && bytes.every((b, j) => b === other[j]);
    });
  };
  const derive = async (password, salt) => {
    if (typeof password !== "string" || password.length < 8 || password.length > 1024) fail();
    const bytes = new TextEncoder().encode(password);
    try {
      const material = await cryptoProvider.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
      return await cryptoProvider.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    } finally {
      bytes.fill(0);
    }
  };
  const seal = async (key2, name, revision, value) => {
    const plain = new TextEncoder().encode(JSON.stringify(value));
    if (plain.length > MAX_BYTES) {
      plain.fill(0);
      fail();
    }
    const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
    try {
      return { schema: SCHEMA, revision, iv, ciphertext: await cryptoProvider.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad(name, revision) },
        key2,
        plain
      ) };
    } finally {
      plain.fill(0);
    }
  };
  const open = async (key2, name, value) => {
    const sealed = envelope(value);
    let plain;
    try {
      plain = new Uint8Array(await cryptoProvider.subtle.decrypt(
        { name: "AES-GCM", iv: sealed.iv, additionalData: aad(name, sealed.revision) },
        key2,
        sealed.ciphertext
      ));
    } catch {
      fail();
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    } finally {
      plain.fill(0);
    }
  };
  const lock = () => {
    epoch++;
    key = null;
    keyRecord = null;
    newKey = false;
    for (const tx of pending) {
      try {
        tx.abort();
      } catch {
      }
    }
  };
  const close = () => {
    if (!closed) {
      lock();
      closed = true;
      database.close();
    }
  };
  database.onversionchange = close;
  const requiresPassword = (policy) => {
    if (policy === void 0) return false;
    const p = policy;
    if (!p || p.schema !== "stealthos-wallet-password-policy-v1" || typeof p.required !== "boolean") fail();
    return p.required;
  };
  const deviceKey = (value, record) => {
    const d = value;
    if (!d || d.schema !== "stealthos-wallet-device-key-v1" || !d.key || d.key.type !== "secret" || d.key.extractable !== false || d.key.algorithm.name !== "AES-GCM" || d.key.algorithm.length !== 256 || d.key.usages.slice().sort().join() !== "decrypt,encrypt") return null;
    try {
      return sameKeyRecord(record, d.record) ? d : null;
    } catch {
      return null;
    }
  };
  const savedUnlock = async () => {
    const { table, done } = transaction("readonly");
    const [policy, record, device] = await Promise.all([request(table.get(policyName)), request(table.get(keyName)), request(table.get(deviceName))]);
    await done;
    return { required: requiresPassword(policy), record, device: record ? deviceKey(device, record) : null };
  };
  const persistDevice = async (required) => {
    const current = locked(), started = epoch, metadata = keyRecord;
    if (!metadata || newKey) fail();
    const { table, tx, done } = transaction("readwrite");
    try {
      const [policy, record] = await Promise.all([request(table.get(policyName)), request(table.get(keyName))]);
      live(started);
      if (!sameKeyRecord(record, metadata)) fail();
      const requirePassword = required ?? requiresPassword(policy);
      if (required !== void 0) await request(table.put({ schema: "stealthos-wallet-password-policy-v1", required }, policyName));
      if (requirePassword) await request(table.delete(deviceName));
      else await request(table.put({ schema: "stealthos-wallet-device-key-v1", key: current, record: metadata }, deviceName));
      await done;
      live(started);
      return !requirePassword;
    } catch (error) {
      try {
        tx.abort();
      } catch {
      }
      await done.catch(() => {
      });
      throw error;
    }
  };
  const backend = {
    capabilities: { localOnly: true, encryptedAtRest: true, durableAtomicCompareAndSwap: true },
    async passwordSettings() {
      live();
      const saved = await savedUnlock();
      return { requirePassword: saved.required, canUnlockWithoutPassword: !saved.required && Boolean(saved.device) };
    },
    async unlockOnDevice() {
      live();
      lock();
      const started = epoch, saved = await savedUnlock();
      live(started);
      if (saved.required || !saved.device) return false;
      const marker = await open(saved.device.key, keyName, saved.record);
      live(started);
      if (JSON.stringify(marker) !== JSON.stringify({ scope })) fail();
      const current = await savedUnlock();
      live(started);
      if (current.required || !current.device || !sameKeyRecord(current.record, saved.device.record)) return false;
      key = saved.device.key;
      keyRecord = saved.device.record;
      return true;
    },
    rememberIfAllowed: () => persistDevice(void 0),
    async setRequirePassword(required) {
      if (typeof required !== "boolean") fail();
      await persistDevice(required);
    },
    async unlock(password) {
      live();
      lock();
      const started = epoch;
      const record = await get(keyName);
      live(started);
      if (record === void 0) {
        const salt = cryptoProvider.getRandomValues(new Uint8Array(32)), candidate = await derive(password, salt);
        const created = { ...await seal(candidate, keyName, "0", { scope }), salt, iterations: ITERATIONS };
        live(started);
        key = candidate;
        keyRecord = created;
        newKey = true;
        return;
      }
      live(started);
      if (!record || record.iterations !== ITERATIONS || !(record.salt instanceof Uint8Array) || record.salt.length !== 32) fail();
      const opened = await derive(password, record.salt), marker = await open(opened, keyName, record);
      live(started);
      if (JSON.stringify(marker) !== JSON.stringify({ scope })) fail();
      key = opened;
      keyRecord = record;
    },
    async hasRecoveryPhrase() {
      live();
      return await get(scope + "/privacy-recovery-phrase-v1") !== void 0;
    },
    async read(name) {
      const current = locked(), started = epoch;
      namespace(name);
      const sealed = await get(name);
      live(started);
      if (sealed === void 0) return { revision: "0", entries: [] };
      const entries = await open(current, name, sealed);
      live(started);
      if (!Array.isArray(entries)) fail();
      return { revision: envelope(sealed).revision, entries };
    },
    async compareAndSwap({ namespace: name, expectedRevision, entries }) {
      const current = locked(), started = epoch;
      namespace(name);
      const metadata = keyRecord;
      if (!metadata) fail();
      if (!/^(0|[1-9][0-9]{0,37})$/u.test(expectedRevision) || !Array.isArray(entries)) fail();
      const revision = (BigInt(expectedRevision) + 1n).toString(), sealed = await seal(current, name, revision, entries);
      live(started);
      const { table, tx, done } = transaction("readwrite");
      try {
        const storedKey = await request(table.get(keyName));
        if (storedKey === void 0 ? !newKey : !sameKeyRecord(storedKey, metadata)) fail();
        const previous = await request(table.get(name)), actual = previous === void 0 ? "0" : envelope(previous).revision;
        live(started);
        if (actual !== expectedRevision) {
          await done;
          return { committed: false, revision: actual };
        }
        if (storedKey === void 0) await request(table.put(metadata, keyName));
        await request(table.put(sealed, name));
        await done;
        live(started);
        newKey = false;
        return { committed: true, revision };
      } catch (error) {
        try {
          tx.abort();
        } catch {
        }
        await done.catch(() => {
        });
        throw error;
      }
    },
    async exportRecoveryBackup(record) {
      const current = locked(), started = epoch, metadata = keyRecord;
      if (!metadata) fail();
      const sealed = await seal(current, "@recovery-backup/v1", "0", record);
      live(started);
      const hex = (data) => Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
      return {
        schema: "stealthos-private-wallet-backup-v1",
        scope,
        iterations: ITERATIONS,
        salt: hex(metadata.salt),
        iv: hex(sealed.iv),
        ciphertext: hex(new Uint8Array(sealed.ciphertext))
      };
    },
    scoped(operationScope) {
      const ownerScope = scope.replace(/^vanta-wallet-v1\//u, "vanta-host-v1/");
      if (!scope.startsWith("vanta-wallet-v1/") || !operationScope.startsWith(ownerScope + "/") || !/^eip155:[1-9][0-9]*\/0x[0-9a-f]{64}$/u.test(operationScope.slice(ownerScope.length + 1))) fail();
      const map = (name) => {
        if (!name.startsWith(operationScope + "/")) fail();
        return scope + "/generation/" + encodeURIComponent(name);
      };
      return Object.freeze({
        capabilities: backend.capabilities,
        read: (name) => backend.read(map(name)),
        compareAndSwap: (input) => backend.compareAndSwap({ ...input, namespace: map(input.namespace) })
      });
    },
    lock,
    close
  };
  return Object.freeze(backend);
}
export {
  createFamilyWalletStoreBackend,
  decryptFamilyWalletRecoveryBackup
};
