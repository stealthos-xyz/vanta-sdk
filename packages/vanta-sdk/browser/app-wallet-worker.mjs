// browser/app-wallet-worker.ts
import { quoteFamilyNetRoute } from "../fresh/family-route-review.mjs";
import { createFamilyBalanceCache } from "../fresh/family-balance-cache.mjs";
import { createFamilyPublicArtifactCache, walletWarmupPins, depositWarmupPins, enhancedWarmupPins } from "../fresh/family-public-artifact-cache.mjs";
import { DEPOSIT_INSUFFICIENT_FUNDS, depositFailure, publicDepositFailure, readDepositFailure } from "../fresh/family-deposit-errors.mjs";
import { hexlify, keccak256, toUtf8Bytes, randomBytes } from "ethers";
import { getCompiledFamilyEvmRelease } from "../fresh/family-network.mjs";
import { getCompiledVantaFamilyProofResources } from "../fresh/family-proof-resources.mjs";
import { createFamilyRpcProviders } from "../fresh/family-rpc.mjs";
import { createFamilyCustomerHandles } from "../fresh/family-customer-handles.mjs";
import {
  createVantaHostAtomicStore,
  createVantaHostPrivacyVault,
  createVantaLocalPrivacyWallet,
  vantaHostStorageScope
} from "../fresh/host-storage.mjs";
import { createVantaFamilyEnhancedHost } from "../fresh/family-enhanced-host.mjs";
import { createVantaFamilyDepositHost } from "../fresh/family-deposit-host.mjs";
import { createVantaFamilyPrivateSendHost, createVantaFamilyWithdrawalHost } from "../fresh/family-normal-host.mjs";
import { createVantaFamilyRoutedHost } from "../fresh/family-routed-host.mjs";

// browser/encrypted-store.ts
var DATABASE = "stealthos-vanta-family-host-v1";
var TABLE = "ciphertexts";
var SCHEMA = "vanta-family-browser-store-v1";
var ITERATIONS = 6e5;
var MAX_BYTES = 16 * 1024 * 1024;
function fail() {
  throw Error("The encrypted private wallet store is locked or invalid.");
}
var request = (input) => new Promise((accept, reject) => {
  input.onsuccess = () => accept(input.result);
  input.onerror = () => reject(input.error ?? Error("Private storage request failed."));
});
async function createFamilyWalletStoreBackend({
  scope: scope2,
  indexedDB: factory = globalThis.indexedDB,
  cryptoProvider = globalThis.crypto
}) {
  if (!/^(?:vanta-wallet-v1\/[^/]+\/0x[0-9a-f]{40}|vanta-host-v1\/[^/]+\/0x[0-9a-f]{40}\/eip155:[1-9][0-9]*\/0x[0-9a-f]{64})$/u.test(scope2) || scope2.length > 1024 || !factory || !cryptoProvider?.subtle) fail();
  const opening = factory.open(DATABASE, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(TABLE);
  const database = await new Promise((accept, reject) => {
    opening.onsuccess = () => accept(opening.result);
    opening.onerror = () => reject(opening.error ?? Error("Private storage could not open."));
    opening.onblocked = () => reject(Error("Close the other wallet tab before upgrading private storage."));
  });
  let key = null, keyRecord = null, newKey = false, closed = false, epoch2 = 0;
  const pending = /* @__PURE__ */ new Set(), keyName = "@key/" + scope2, deviceName = "@device-key/" + scope2, policyName = "@password-policy/" + scope2;
  const live2 = (revision = epoch2) => {
    if (closed || revision !== epoch2) fail();
  };
  const locked = () => {
    live2();
    if (!key) fail();
    return key;
  };
  const namespace = (value) => {
    if (typeof value !== "string" || !value.startsWith(scope2 + "/") || value.length > scope2.length + 8192) fail();
    return value;
  };
  const aad = (name, revision) => new TextEncoder().encode(JSON.stringify([SCHEMA, scope2, name, revision]));
  const transaction = (mode) => {
    live2();
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
    epoch2++;
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
    const current = locked(), started2 = epoch2, metadata = keyRecord;
    if (!metadata || newKey) fail();
    const { table, tx, done } = transaction("readwrite");
    try {
      const [policy, record] = await Promise.all([request(table.get(policyName)), request(table.get(keyName))]);
      live2(started2);
      if (!sameKeyRecord(record, metadata)) fail();
      const requirePassword = required ?? requiresPassword(policy);
      if (required !== void 0) await request(table.put({ schema: "stealthos-wallet-password-policy-v1", required }, policyName));
      if (requirePassword) await request(table.delete(deviceName));
      else await request(table.put({ schema: "stealthos-wallet-device-key-v1", key: current, record: metadata }, deviceName));
      await done;
      live2(started2);
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
  const backend2 = {
    capabilities: { localOnly: true, encryptedAtRest: true, durableAtomicCompareAndSwap: true },
    async passwordSettings() {
      live2();
      const saved = await savedUnlock();
      return { requirePassword: saved.required, canUnlockWithoutPassword: !saved.required && Boolean(saved.device) };
    },
    async unlockOnDevice() {
      live2();
      lock();
      const started2 = epoch2, saved = await savedUnlock();
      live2(started2);
      if (saved.required || !saved.device) return false;
      const marker = await open(saved.device.key, keyName, saved.record);
      live2(started2);
      if (JSON.stringify(marker) !== JSON.stringify({ scope: scope2 })) fail();
      const current = await savedUnlock();
      live2(started2);
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
      live2();
      lock();
      const started2 = epoch2;
      const record = await get(keyName);
      live2(started2);
      if (record === void 0) {
        const salt = cryptoProvider.getRandomValues(new Uint8Array(32)), candidate = await derive(password, salt);
        const created = { ...await seal(candidate, keyName, "0", { scope: scope2 }), salt, iterations: ITERATIONS };
        live2(started2);
        key = candidate;
        keyRecord = created;
        newKey = true;
        return;
      }
      live2(started2);
      if (!record || record.iterations !== ITERATIONS || !(record.salt instanceof Uint8Array) || record.salt.length !== 32) fail();
      const opened = await derive(password, record.salt), marker = await open(opened, keyName, record);
      live2(started2);
      if (JSON.stringify(marker) !== JSON.stringify({ scope: scope2 })) fail();
      key = opened;
      keyRecord = record;
    },
    async hasRecoveryPhrase() {
      live2();
      return await get(scope2 + "/privacy-recovery-phrase-v1") !== void 0;
    },
    async read(name) {
      const current = locked(), started2 = epoch2;
      namespace(name);
      const sealed = await get(name);
      live2(started2);
      if (sealed === void 0) return { revision: "0", entries: [] };
      const entries = await open(current, name, sealed);
      live2(started2);
      if (!Array.isArray(entries)) fail();
      return { revision: envelope(sealed).revision, entries };
    },
    async compareAndSwap({ namespace: name, expectedRevision, entries }) {
      const current = locked(), started2 = epoch2;
      namespace(name);
      const metadata = keyRecord;
      if (!metadata) fail();
      if (!/^(0|[1-9][0-9]{0,37})$/u.test(expectedRevision) || !Array.isArray(entries)) fail();
      const revision = (BigInt(expectedRevision) + 1n).toString(), sealed = await seal(current, name, revision, entries);
      live2(started2);
      const { table, tx, done } = transaction("readwrite");
      try {
        const storedKey = await request(table.get(keyName));
        if (storedKey === void 0 ? !newKey : !sameKeyRecord(storedKey, metadata)) fail();
        const previous = await request(table.get(name)), actual = previous === void 0 ? "0" : envelope(previous).revision;
        live2(started2);
        if (actual !== expectedRevision) {
          await done;
          return { committed: false, revision: actual };
        }
        if (storedKey === void 0) await request(table.put(metadata, keyName));
        await request(table.put(sealed, name));
        await done;
        live2(started2);
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
      const current = locked(), started2 = epoch2, metadata = keyRecord;
      if (!metadata) fail();
      const sealed = await seal(current, "@recovery-backup/v1", "0", record);
      live2(started2);
      const hex = (data) => Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
      return {
        schema: "stealthos-private-wallet-backup-v1",
        scope: scope2,
        iterations: ITERATIONS,
        salt: hex(metadata.salt),
        iv: hex(sealed.iv),
        ciphertext: hex(new Uint8Array(sealed.ciphertext))
      };
    },
    scoped(operationScope) {
      const ownerScope = scope2.replace(/^vanta-wallet-v1\//u, "vanta-host-v1/");
      if (!scope2.startsWith("vanta-wallet-v1/") || !operationScope.startsWith(ownerScope + "/") || !/^eip155:[1-9][0-9]*\/0x[0-9a-f]{64}$/u.test(operationScope.slice(ownerScope.length + 1))) fail();
      const map = (name) => {
        if (!name.startsWith(operationScope + "/")) fail();
        return scope2 + "/generation/" + encodeURIComponent(name);
      };
      return Object.freeze({
        capabilities: backend2.capabilities,
        read: (name) => backend2.read(map(name)),
        compareAndSwap: (input) => backend2.compareAndSwap({ ...input, namespace: map(input.namespace) })
      });
    },
    lock,
    close
  };
  return Object.freeze(backend2);
}

// browser/routing.mjs
var FAMILY_ROUTING_HEADERS = Object.freeze([
  "X-StealthOS-Network",
  "X-StealthOS-Generation",
  "X-StealthOS-Pool"
]);
function readFamilyRelayRouting(input) {
  const headers = new Headers(input), values = FAMILY_ROUTING_HEADERS.map((name) => headers.get(name));
  if (values.every((value) => value === null)) return null;
  const [networkId, generationId, pool] = values;
  if (!/^eip155:[1-9][0-9]*$/u.test(networkId ?? "") || !/^0x[0-9a-f]{64}$/u.test(generationId ?? "") || !/^0x[0-9a-fA-F]{40}$/u.test(pool ?? "") || BigInt(pool) === 0n)
    throw Error("Invalid family relay context.");
  return Object.freeze({ networkId, generationId, pool: pool.toLowerCase() });
}
function familyRelayRoutingHeaders(context) {
  const headers = Object.fromEntries(FAMILY_ROUTING_HEADERS.map((name, i) => [name, [context?.networkId, context?.generationId, context?.pool][i]]));
  readFamilyRelayRouting(headers);
  return headers;
}

// browser/app-wallet-worker.ts
var compiledRelease = getCompiledFamilyEvmRelease();
var chainId = Number(compiledRelease.pins.networkId.split(":")[1]);
var scope = globalThis;
var MAX_AMOUNT = ((1n << 120n) - 1n).toString();
function fail2() {
  throw Error("Family wallet runtime is unavailable.");
}
function normalBatchActivity(row) {
  if (!row.batch) fail2();
  return {
    transactionId: row.preparedId,
    enhanced: false,
    batch: true,
    recipientCount: row.recipientCount,
    payments: row.payments,
    amountAtomic: row.amountAtomic,
    totalDebitAtomic: row.totalDebitAtomic,
    status: {
      authorized: ["included", "finalized"].includes(row.phase),
      authorizationFailed: ["failed-finalized", "expired-unused"].includes(row.phase),
      finalized: row.phase === "finalized",
      transactionHash: row.transactionHash
    }
  };
}
var port = null;
var serial = 0;
var epoch = 0;
var busy = false;
var started = false;
var provider;
var independent;
var backend;
var store;
var balanceCache;
var wallet;
var enhanced;
var deposit;
var depositAction = false;
var useDeviceUnlock = false;
var customerHandles;
var publicWithdrawal;
var publicWithdrawalPending;
var withdrawalQuotes = /* @__PURE__ */ new Map();
var assetRevision = 0;
var privateSend;
var privateSendAction = false;
var routedHosts = /* @__PURE__ */ new Map();
var routedPending = /* @__PURE__ */ new Map();
var routedAction = false;
var routeEpoch = 0;
var disposeRoutes = () => {
  routeEpoch++;
  for (const host of routedHosts.values()) host.dispose();
  routedHosts.clear();
  routedPending.clear();
};
var config;
var session;
var controller = new AbortController();
var uiPending = /* @__PURE__ */ new Map();
function secret(kind, value) {
  if (!port || controller.signal.aborted) return Promise.reject(Error("Wallet is locked."));
  return new Promise((accept, reject) => {
    const id = ++serial;
    uiPending.set(id, { accept, reject });
    port.postMessage({ id, kind, value });
  });
}
function disposeAssetHosts() {
  assetRevision++;
  enhanced?.dispose();
  enhanced = void 0;
  deposit?.dispose();
  deposit = void 0;
  publicWithdrawal?.dispose();
  publicWithdrawal = void 0;
  publicWithdrawalPending = void 0;
  withdrawalQuotes.clear();
  privateSend?.dispose();
  privateSend = void 0;
  disposeRoutes();
}
function dispose() {
  epoch++;
  controller.abort();
  balanceCache = void 0;
  disposeAssetHosts();
  wallet?.lock();
  store?.close();
  backend?.close();
  for (const value of uiPending.values()) value.reject(Error("Wallet is locked."));
  uiPending.clear();
  port?.close();
  void provider?.destroy();
  void independent?.destroy();
}
var live = (revision = epoch) => {
  controller.signal.throwIfAborted();
  if (revision !== epoch || session.expiresAt <= Math.floor(Date.now() / 1e3)) fail2();
};
async function withdrawalHost() {
  if (publicWithdrawal) return publicWithdrawal;
  if (publicWithdrawalPending) return publicWithdrawalPending;
  const revision = epoch, selectedRevision = assetRevision;
  const task = withdrawalForAsset(config.asset ?? "native", revision).then((host) => {
    try {
      live(revision);
      if (selectedRevision !== assetRevision) fail2();
    } catch (e) {
      host.dispose();
      throw e;
    }
    publicWithdrawal = host;
    return host;
  }).finally(() => {
    if (publicWithdrawalPending === task) publicWithdrawalPending = void 0;
  });
  publicWithdrawalPending = task;
  return task;
}
async function routedHost(operation) {
  const cached = routedHosts.get(operation);
  if (cached) return cached;
  const pending = routedPending.get(operation);
  if (pending) return pending;
  const revision = epoch, routesRevision = routeEpoch;
  const task = routeForAsset(config.asset ?? "native", operation, revision, routesRevision).then((host) => {
    try {
      live(revision);
      if (routeEpoch !== routesRevision) fail2();
    } catch (error) {
      host.dispose();
      throw error;
    }
    routedHosts.set(operation, host);
    return host;
  }).finally(() => {
    if (routedPending.get(operation) === task) routedPending.delete(operation);
  });
  routedPending.set(operation, task);
  return task;
}
var publicArtifacts;
var fetcher = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === new URL(config.relayerUrl).origin && url.pathname === "/api/v1/relay/vanta-family/private-routes/resolve") {
    if (!depositAction || init?.method && init.method !== "GET" || [...url.searchParams.keys()].join() !== "handle") fail2();
    return fetcher(new URL("/api/vanta-v8/deposit/route", url).href, { method: "POST", body: JSON.stringify({ handle: url.searchParams.get("handle") }) });
  }
  if (url.origin !== new URL(config.relayerUrl).origin || !/^\/api\/vanta-v8\/(?:enhanced|deposit|normal|routed)\//u.test(url.pathname))
    return publicArtifacts ? publicArtifacts.fetch(input, init) : fetch(input, init);
  if (init?.method !== "POST" || typeof init.body !== "string" || init.body.length > 1024 * 1024 || url.search || url.hash || url.username || url.password) fail2();
  live();
  const routing = readFamilyRelayRouting(init?.headers);
  if (url.pathname.startsWith("/api/vanta-v8/enhanced/") && !routing) fail2();
  if (url.pathname.startsWith("/api/vanta-v8/normal/") && !privateSendAction) fail2();
  if (url.pathname.startsWith("/api/vanta-v8/routed/") && !routedAction) fail2();
  const result = await secret("relayFetch", {
    path: url.pathname,
    body: init.body,
    headers: routing ? familyRelayRoutingHeaders(routing) : {}
  });
  live();
  if (!result || !Number.isInteger(result.status) || result.status < 100 || result.status > 599 || typeof result.body !== "string" || result.body.length > 1024 * 1024) fail2();
  return new Response(result.body, { status: result.status, headers: { "Content-Type": result.contentType } });
};
async function initialize(value, secretPort) {
  if (started || !(secretPort instanceof MessagePort)) fail2();
  started = true;
  config = value;
  port = secretPort;
  if (!value || value.session.networkId !== compiledRelease.pins.networkId || !/^0x[0-9a-f]{40}$/u.test(value.session.wallet) || ![value.session.subjectId, value.session.sessionId].every((v) => /^[A-Za-z0-9_-]{1,128}$/u.test(v)) || !Number.isSafeInteger(value.session.expiresAt)) fail2();
  session = Object.freeze({
    subjectId: value.session.subjectId,
    sessionId: value.session.sessionId,
    expiresAt: value.session.expiresAt,
    permissions: ["prepare", "authorize", "monitor", "recover", "cancel"],
    maximumDebitAtomic: MAX_AMOUNT,
    maximumSessionDebitAtomic: MAX_AMOUNT,
    allowedDestinations: null
  });
  live();
  port.onmessage = ({ data }) => {
    const pending = uiPending.get(data?.id);
    if (!pending) return;
    uiPending.delete(data.id);
    if (data.ok === true) pending.accept(data.value);
    else {
      const code = data.code === "USER_REJECTED" || data.code === DEPOSIT_INSUFFICIENT_FUNDS ? data.code : void 0;
      pending.reject(readDepositFailure(data.depositFailure) ?? Object.assign(Error("Trusted wallet action was unavailable."), { code }));
    }
  };
  port.start();
  const https = (raw) => {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) fail2();
    return u;
  };
  const endpoints = { primary: value.rpcUrl, verification: value.verificationRpcUrl };
  https(value.relayerUrl);
  https(value.artifactBaseUrl);
  const proofInventory = getCompiledVantaFamilyProofResources(compiledRelease);
  publicArtifacts = createFamilyPublicArtifactCache({
    baseUrl: value.artifactBaseUrl,
    pins: (value.paymentRecipient ? depositWarmupPins : walletWarmupPins)(proofInventory),
    enhancedPins: value.paymentRecipient ? [] : enhancedWarmupPins(proofInventory),
    fetcher: (input, init) => fetch(input, init)
  });
  let release;
  try {
    release = getCompiledFamilyEvmRelease();
  } catch {
    throw Object.assign(Error("Compiled family release is not ready."), { code: "NOT_READY" });
  }
  if (release.pins.networkId !== compiledRelease.pins.networkId) fail2();
  ({ provider, verificationProvider: independent } = createFamilyRpcProviders(endpoints.primary, endpoints.verification, chainId));
  live();
  const identity = {
    accountId: value.paymentRecipient ? "payment-" + keccak256(toUtf8Bytes(session.subjectId)).slice(2) : session.subjectId,
    address: value.session.wallet,
    networkId: release.pins.networkId,
    generationId: release.pins.generationId
  };
  backend = await createFamilyWalletStoreBackend({ scope: vantaHostStorageScope(identity) });
  store = createVantaHostAtomicStore({ host: backend, scope: identity });
  if (value.paymentRecipient) return { hasBackup: false, requirePassword: false, canUnlockWithoutPassword: false, release: {
    chainId,
    networkLabel: release.pins.networkId,
    generationId: release.pins.generationId,
    ceremony: { releaseHash: release.setup.ceremonyReleaseHash },
    bootstrap: { finalizedBlockNumber: null },
    pools: release.lock.contracts.filter((c) => c.kind === "pool").map((c) => ({ asset: c.name, pool: c.address }))
  } };
  const vault = createVantaHostPrivacyVault({ store });
  wallet = createVantaLocalPrivacyWallet({ vault, ui: {
    async authenticate() {
      const revision = epoch;
      if (useDeviceUnlock) {
        const unlocked = await backend.unlockOnDevice();
        live(revision);
        if (!unlocked) throw Object.assign(Error("Wallet password required."), { code: "PASSWORD_REQUIRED" });
        return true;
      }
      const password = await secret("password");
      if (typeof password !== "string") return false;
      await backend.unlock(password);
      live(revision);
      return true;
    },
    async confirmBackup(phrase) {
      return await secret("confirmBackup", phrase) === true;
    },
    async requestRestorePhrase() {
      const phrase = await secret("restorePhrase");
      if (typeof phrase !== "string") fail2();
      return phrase;
    }
  } });
  return { hasBackup: await backend.hasRecoveryPhrase(), ...await backend.passwordSettings(), release: {
    chainId,
    networkLabel: release.pins.networkId,
    generationId: release.pins.generationId,
    ceremony: { releaseHash: release.setup.ceremonyReleaseHash },
    bootstrap: { finalizedBlockNumber: null },
    pools: release.lock.contracts.filter((c) => c.kind === "pool").map((c) => ({ asset: c.name, pool: c.address }))
  } };
}
function enhancedForAsset(asset) {
  return createVantaFamilyEnhancedHost({
    walletController: wallet,
    store,
    provider,
    verificationProvider: independent,
    relayerUrl: config.relayerUrl,
    artifactBaseUrl: config.artifactBaseUrl,
    asset,
    fetcher,
    walletAddress: config.session.wallet,
    signConsent: async (request2) => {
      const revision = epoch;
      live();
      const signature = await secret("walletSignConsent", request2);
      live();
      if (revision !== epoch || typeof signature !== "string") fail2();
      return signature;
    },
    getSession: () => {
      live();
      return session;
    },
    signal: controller.signal,
    onProgress: () => scope.postMessage({ kind: "progress" })
  });
}
function depositForAsset(asset) {
  return createVantaFamilyDepositHost({
    walletController: wallet,
    store,
    provider,
    verificationProvider: independent,
    relayerUrl: config.relayerUrl,
    artifactBaseUrl: config.artifactBaseUrl,
    asset,
    walletAddress: config.session.wallet,
    fetcher,
    signal: controller.signal,
    partnerAssetConfiguration: config.partnerAssetConfiguration,
    getSession: () => {
      live();
      return { ...session, permissions: depositAction ? [...session.permissions, "deposit"] : session.permissions };
    },
    approveDeposit: async (review) => {
      live();
      if (!depositAction) fail2();
      const revision = epoch;
      const result = await secret("depositApprove", review);
      live(revision);
      return result === true;
    },
    submitTransaction: async (request2) => {
      live();
      if (!depositAction) fail2();
      const revision = epoch;
      const result = await secret("depositSubmit", request2);
      live(revision);
      return result;
    },
    onProgress: () => scope.postMessage({ kind: "progress" })
  });
}
function withdrawalForAsset(asset, revision = epoch) {
  return createVantaFamilyWithdrawalHost({
    walletController: wallet,
    store,
    provider,
    verificationProvider: independent,
    relayerUrl: config.relayerUrl,
    artifactBaseUrl: config.artifactBaseUrl,
    asset,
    walletAddress: config.session.wallet,
    fetcher,
    signal: controller.signal,
    partnerAssetConfiguration: config.partnerAssetConfiguration,
    approvePrivateSend: async (review) => {
      live(revision);
      if (!privateSendAction) fail2();
      return await secret("privateSendApprove", review) === true;
    }
  });
}
function routeForAsset(asset, operation, revision = epoch, routesRevision = routeEpoch) {
  return createVantaFamilyRoutedHost({
    operation,
    walletController: wallet,
    store,
    provider,
    verificationProvider: independent,
    relayerUrl: config.relayerUrl,
    artifactBaseUrl: config.artifactBaseUrl,
    asset,
    walletAddress: config.session.wallet,
    fetcher,
    signal: controller.signal,
    partnerAssetConfiguration: config.partnerAssetConfiguration,
    approveRoute: async (review) => {
      live(revision);
      if (!routedAction || routeEpoch !== routesRevision) fail2();
      const approved = await secret("routedApprove", review);
      live(revision);
      return approved === true;
    }
  });
}
function privateSendForAsset(asset) {
  return createVantaFamilyPrivateSendHost({
    walletController: wallet,
    store,
    provider,
    verificationProvider: independent,
    relayerUrl: config.relayerUrl,
    artifactBaseUrl: config.artifactBaseUrl,
    asset,
    walletAddress: config.session.wallet,
    fetcher,
    signal: controller.signal,
    partnerAssetConfiguration: config.partnerAssetConfiguration,
    approvePrivateSend: async (review) => {
      live();
      if (!privateSendAction) fail2();
      const revision = epoch;
      const approved = await secret("privateSendApprove", review);
      live(revision);
      return approved === true;
    }
  });
}
var historyCommands = /* @__PURE__ */ new Set([
  "listDeposits",
  "listPrivateSends",
  "listRoutes",
  "listWithdrawals",
  "reconcileDeposit",
  "reconcilePrivateSend",
  "reconcileRoute",
  "monitorWithdrawal",
  "monitorPublicBatch"
]);
function activityHosts(asset) {
  const hosts = [];
  const keep = async (opening) => {
    const host = await opening;
    hosts.push(host);
    return host;
  };
  return {
    enhanced: () => keep(enhancedForAsset(asset)),
    deposit: () => keep(depositForAsset(asset)),
    withdrawal: () => keep(withdrawalForAsset(asset)),
    privateSend: () => keep(privateSendForAsset(asset)),
    route: (operation) => keep(routeForAsset(asset, operation)),
    dispose: () => {
      for (const host of hosts) host.dispose();
    }
  };
}
async function invokeScoped(command, payload) {
  if (!Object.hasOwn(payload, "historyAsset")) return invoke(command, payload);
  live();
  const { historyAsset, ...args } = payload;
  if (!store || !enhanced || config.paymentRecipient || !historyCommands.has(command) || typeof historyAsset !== "string") fail2();
  const pool = getCompiledVantaFamilyProofResources(compiledRelease).funding.pools.find((p) => historyAsset === "native" ? BigInt(p.asset) === 0n : p.asset === historyAsset);
  if (!pool) fail2();
  let namespaces = [];
  if (command === "listDeposits" && args.includeCompleted === true && Object.keys(args).length === 1)
    namespaces = ["family-kzg-deposits-v1/" + pool.pool];
  if (command === "listPrivateSends" && Object.keys(args).length === 0)
    namespaces = ["family-private-sends-v1/" + pool.pool];
  if (command === "listRoutes" && args.operation === 5 && (args.cached === true || args.cached === void 0) && Object.keys(args).every((key) => key === "operation" || key === "cached") && getCompiledVantaFamilyProofResources(compiledRelease).funding.routes?.bnmPool === pool.pool)
    namespaces = ["family-routed-v1/5/" + pool.pool];
  if (command === "listWithdrawals" && args.cached === true && Object.keys(args).length === 1)
    namespaces = [
      "family-public-withdrawals-v1/" + pool.pool,
      "enhanced-funding-preparations-v1/" + pool.pool,
      "enhanced-withdrawals-v1/" + pool.pool + "/" + pool.asset
    ];
  if (namespaces.length) {
    const journalRows = await Promise.all(namespaces.map((namespace) => store.read(namespace)));
    if (journalRows.every((rows) => Array.isArray(rows) && rows.length === 0)) return [];
  }
  if (pool.pool === enhanced.host.context.pool) return invoke(command, args);
  const history = activityHosts(historyAsset);
  try {
    return await invoke(command, args, history);
  } finally {
    history.dispose();
  }
}
async function invoke(command, payload, history) {
  live();
  if (!wallet && !config.paymentRecipient || !store) fail2();
  const depositCommands = ["quoteDeposit", "prepareReviewedDeposit", "executeDeposit", "reconcileDeposit", "listDeposits"];
  if (config.paymentRecipient && !["openPublicPayment", ...depositCommands].includes(command)) fail2();
  if (command === "openPublicPayment") {
    if (!config.paymentRecipient || Object.keys(payload).length || deposit) fail2();
    if (!await backend.unlockOnDevice()) {
      await backend.unlock(hexlify(randomBytes(32)));
      await store.transact("public-payment-device-v1", (rows) => ({ next: rows, result: null }));
      await backend.rememberIfAllowed();
    }
    deposit = await createVantaFamilyDepositHost({
      paymentRecipient: config.paymentRecipient,
      store,
      provider,
      verificationProvider: independent,
      relayerUrl: config.relayerUrl,
      artifactBaseUrl: config.artifactBaseUrl,
      asset: config.asset ?? "native",
      walletAddress: config.session.wallet,
      fetcher,
      signal: controller.signal,
      partnerAssetConfiguration: config.partnerAssetConfiguration,
      getSession: () => {
        live();
        return { ...session, permissions: depositAction ? ["deposit"] : [] };
      },
      approveDeposit: async (review) => {
        live();
        if (!depositAction) fail2();
        const revision = epoch;
        const approved = await secret("depositApprove", review);
        live(revision);
        return approved === true;
      },
      submitTransaction: async (request2) => {
        live();
        if (!depositAction) fail2();
        const revision = epoch;
        const sent = await secret("depositSubmit", request2);
        live(revision);
        return sent;
      }
    });
    const resource = getCompiledVantaFamilyProofResources(compiledRelease).funding.pools.find((p) => p.pool.toLowerCase() === config.paymentRecipient.pool.toLowerCase());
    if (!resource) fail2();
    setTimeout(() => {
      void publicArtifacts?.warm().catch(() => {
      });
      void deposit?.warmProofRuntime().catch(() => {
      });
      void deposit?.warmWalletClearance().catch(() => {
      });
    }, 0);
    return { networkId: compiledRelease.pins.networkId, generationId: compiledRelease.pins.generationId, pool: resource.pool, assetAddress: resource.asset, assetSymbol: resource.assetSymbol, assetDecimals: resource.assetDecimals };
  }
  if (command === "passwordSettings") {
    if (Object.keys(payload).length) fail2();
    return backend.passwordSettings();
  }
  if (command === "setPasswordRequirement") {
    if (!enhanced || Object.keys(payload).join() !== "requirePassword" || typeof payload.requirePassword !== "boolean") fail2();
    await backend.setRequirePassword(payload.requirePassword);
    return backend.passwordSettings();
  }
  if (command === "selectAsset") {
    if (Object.keys(payload).join() !== "asset" || typeof payload.asset !== "string" || !getCompiledFamilyEvmRelease().lock.contracts.some((c) => c.kind === "pool" && c.address.toLowerCase() === getCompiledVantaFamilyProofResources(getCompiledFamilyEvmRelease()).funding.pools.find((p) => payload.asset === "native" ? BigInt(p.asset) === 0n : p.asset.toLowerCase() === payload.asset)?.pool)) fail2();
    wallet.requireWallet();
  }
  if (command === "create" || command === "unlock" || command === "restore" || command === "autoUnlock" || command === "selectAsset") {
    if (command !== "selectAsset" && Object.keys(payload).length) fail2();
    const switching = command === "selectAsset", nextAsset = switching ? payload.asset : config.asset ?? "native";
    let nextEnhanced, nextDeposit;
    if (!switching) disposeAssetHosts();
    try {
      if (command !== "selectAsset") {
        useDeviceUnlock = command === "autoUnlock";
        try {
          await wallet[command === "autoUnlock" ? "unlock" : command]();
        } finally {
          useDeviceUnlock = false;
        }
      }
      live();
      nextEnhanced = await enhancedForAsset(nextAsset);
      nextDeposit = await depositForAsset(nextAsset);
      const identity = await wallet.requireWallet().publicReceivingIdentity();
      live();
      let cachedBalance = null;
      if (!switching) {
        const resources = getCompiledVantaFamilyProofResources(compiledRelease);
        const privateIdentity = keccak256(toUtf8Bytes(JSON.stringify([
          "STEALTHOS_FAMILY_BALANCE_DISPLAY_V1",
          identity.masterPublicKey.toString(),
          hexlify(identity.viewingPublicKey)
        ])));
        balanceCache = createFamilyBalanceCache({
          store,
          identity: privateIdentity,
          generationId: compiledRelease.pins.generationId,
          pools: resources.funding.pools
        });
        if (command !== "create") cachedBalance = await balanceCache.readSnapshot().catch(() => null);
        await backend.rememberIfAllowed().catch(() => false);
      }
      live();
      if (switching) disposeAssetHosts();
      enhanced = nextEnhanced;
      deposit = nextDeposit;
      config = { ...config, asset: nextAsset };
      const selectedRevision = assetRevision;
      void deposit.warmWalletClearance().catch(() => {
      });
      setTimeout(() => {
        if (selectedRevision !== assetRevision) return;
        void publicArtifacts?.warm().catch(() => {
        });
        void deposit?.warmProofRuntime().catch(() => {
        });
        void withdrawalHost().then((host) => host.warmProofRuntime()).catch(() => {
        });
      }, 0);
      return {
        identity: { masterPublicKey: identity.masterPublicKey.toString(), viewingPublicKey: hexlify(identity.viewingPublicKey) },
        context: enhanced.host.context,
        availability: enhanced.host.getAvailability(),
        cachedBalance
      };
    } catch (error) {
      nextEnhanced?.dispose();
      nextDeposit?.dispose();
      if (!switching) {
        balanceCache = void 0;
        disposeAssetHosts();
        wallet.lock();
        backend.lock();
      }
      throw error;
    }
  }
  if (!enhanced && !(config.paymentRecipient && deposit && depositCommands.includes(command))) fail2();
  if (command === "quoteRoute") {
    const { operation, amountAtomic, slippageBps, receiver } = payload;
    if (Object.keys(payload).sort().join() !== "amountAtomic,operation,receiver,slippageBps" || ![4, 5].includes(Number(operation)) || typeof amountAtomic !== "string" || !/^\d+$/u.test(amountAtomic) || BigInt(amountAtomic) <= 0n || BigInt(amountAtomic) >= 1n << 120n || !Number.isInteger(slippageBps) || Number(slippageBps) < 1 || Number(slippageBps) > 5e3 || typeof receiver !== "string") fail2();
    void routedHost(operation).then((host) => host.warmProofRuntime()).catch(() => {
    });
    return quoteFamilyNetRoute({ provider, verificationProvider: independent, asset: config.asset ?? "native", operation, amountAtomic, slippageBps, receiver });
  }
  if (["handleAvailable", "claimHandle", "checkHandle", "currentHandle", "findHandle", "resolveHandle"].includes(command)) {
    const needsName = ["handleAvailable", "claimHandle", "findHandle", "resolveHandle"].includes(command);
    if (command === "currentHandle") {
      if (Object.keys(payload).join() !== "handleHints" || !Array.isArray(payload.handleHints) || payload.handleHints.length > 16 || payload.handleHints.some((h) => typeof h !== "string")) fail2();
    } else if (needsName ? Object.keys(payload).join() !== "handle" || typeof payload.handle !== "string" : Object.keys(payload).length) fail2();
    customerHandles ??= await createFamilyCustomerHandles({ walletController: wallet, store, provider, verificationProvider: independent, artifactBaseUrl: config.artifactBaseUrl, fetcher, signal: controller.signal, submitTransaction: async (request2) => {
      const revision = epoch;
      const hash = await secret("handleSubmit", request2);
      live(revision);
      if (typeof hash !== "string") fail2();
      return hash;
    }, reconcileTransaction: async (request2) => {
      const revision = epoch;
      const hash = await secret("handleStatus", request2);
      live(revision);
      if (hash !== null && typeof hash !== "string") fail2();
      return hash;
    } });
    if (command === "handleAvailable") return customerHandles.available(payload.handle);
    if (command === "claimHandle") return customerHandles.claim(payload.handle);
    if (command === "checkHandle") return customerHandles.check();
    if (command === "currentHandle") return customerHandles.current(payload.handleHints);
    if (command === "findHandle") return customerHandles.find(payload.handle);
    return customerHandles.resolve(payload.handle, config.asset ?? "native");
  }
  if (["quoteRouteFees", "prepareReviewedRoute", "prepareRoute", "executeRoute", "reconcileRoute", "cancelRoute", "listRoutes"].includes(command)) {
    const operation = payload.operation;
    if (operation !== 4 && operation !== 5) fail2();
    routedAction = true;
    try {
      const op = operation, host = await (history ? history.route(op) : routedHost(op));
      if (command === "listRoutes") {
        if (!["operation", "cached,operation"].includes(Object.keys(payload).sort().join()) || payload.cached !== void 0 && typeof payload.cached !== "boolean") fail2();
        return await host.list({ cached: payload.cached === true });
      }
      if (command === "prepareReviewedRoute") {
        if (Object.keys(payload).sort().join() !== "operation,quoteId" || typeof payload.quoteId !== "string") fail2();
        return await host.prepareReviewed({ quoteId: payload.quoteId });
      }
      if (command === "prepareRoute" || command === "quoteRouteFees") {
        if (Object.keys(payload).filter((k) => k !== "slippageBps").sort().join() !== "amountAtomic,maximumDeliveryFeeAtomic,minimumOutputAtomic,operation,partnerHandle,receiver" || payload.slippageBps !== void 0 && (!Number.isInteger(payload.slippageBps) || Number(payload.slippageBps) < 1 || Number(payload.slippageBps) > 5e3) || ["amountAtomic", "maximumDeliveryFeeAtomic", "minimumOutputAtomic", "partnerHandle", "receiver"].some((k) => typeof payload[k] !== "string")) fail2();
        return await host[command === "quoteRouteFees" ? "quote" : "prepare"](payload);
      }
      if (Object.keys(payload).sort().join() !== "operation,preparedId" || typeof payload.preparedId !== "string") fail2();
      if (command === "executeRoute") return await host.execute({ preparedId: payload.preparedId });
      if (command === "cancelRoute") return await host.cancel({ preparedId: payload.preparedId });
      const result = await host.reconcile({ preparedId: payload.preparedId });
      return op === 5 && result.phase === "finalized" ? await host.monitorDelivery({ preparedId: payload.preparedId }) : result;
    } finally {
      routedAction = false;
    }
  }
  if (["receivingAddress", "quotePrivateSend", "prepareReviewedPrivateSend", "preparePrivateSend", "executePrivateSend", "reconcilePrivateSend", "cancelPrivateSend", "listPrivateSends"].includes(command)) {
    privateSendAction = true;
    try {
      const sendHost = history ? await history.privateSend() : privateSend ??= await privateSendForAsset(config.asset ?? "native");
      if (command === "receivingAddress" || command === "listPrivateSends") {
        if (Object.keys(payload).length) fail2();
        return command === "receivingAddress" ? await sendHost.receivingAddress() : await sendHost.list();
      }
      if (command === "prepareReviewedPrivateSend") {
        if (!["memo,quoteId", "quoteId"].includes(Object.keys(payload).sort().join()) || typeof payload.quoteId !== "string" || payload.memo !== void 0 && typeof payload.memo !== "string") fail2();
        return await sendHost.prepareReviewed({ quoteId: payload.quoteId, memo: payload.memo });
      }
      if (command === "preparePrivateSend" || command === "quotePrivateSend") {
        const fields = Object.keys(payload).sort().join();
        if (fields !== "amountAtomic,partnerHandle,recipient" && !(command === "preparePrivateSend" && fields === "amountAtomic,memo,partnerHandle,recipient" && typeof payload.memo === "string") || typeof payload.amountAtomic !== "string" || typeof payload.partnerHandle !== "string" || !payload.recipient || typeof payload.recipient !== "object" || Array.isArray(payload.recipient)) fail2();
        return await sendHost[command === "quotePrivateSend" ? "quote" : "prepare"](payload);
      }
      if (Object.keys(payload).join() !== "preparedId" || typeof payload.preparedId !== "string") fail2();
      if (command === "executePrivateSend") return await sendHost.execute({ preparedId: payload.preparedId });
      if (command === "cancelPrivateSend") return await sendHost.cancel({ preparedId: payload.preparedId });
      return await sendHost.reconcile({ preparedId: payload.preparedId });
    } finally {
      privateSendAction = false;
    }
  }
  if (command === "quoteDeposit" || command === "prepareReviewedDeposit" || command === "prepareDeposit" || command === "executeDeposit" || command === "reconcileDeposit" || command === "listDeposits") {
    depositAction = true;
    try {
      const depositHost = history ? await history.deposit() : deposit;
      if (!depositHost) fail2();
      if (command === "listDeposits") {
        if (Object.keys(payload).length === 0) return await depositHost.listPendingDeposits();
        if (Object.keys(payload).join() !== "includeCompleted" || payload.includeCompleted !== true) fail2();
        return await depositHost.listDepositHistory();
      }
      if (command === "prepareReviewedDeposit") {
        if (Object.keys(payload).join() !== "quoteId" || typeof payload.quoteId !== "string") fail2();
        return await depositHost.prepareReviewedDeposit({ quoteId: payload.quoteId });
      }
      if (command === "quoteDeposit" || command === "prepareDeposit") {
        if (Object.keys(payload).sort().join() !== "amountAtomic,partnerHandle" || typeof payload.amountAtomic !== "string" || typeof payload.partnerHandle !== "string") fail2();
        return await depositHost[command](payload);
      }
      if (command === "reconcileDeposit" && config.paymentRecipient) {
        if (Object.keys(payload).filter((k) => k !== "transactionHash").join() !== "preparedId" || typeof payload.preparedId !== "string" || payload.transactionHash !== void 0 && (typeof payload.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(payload.transactionHash))) fail2();
        return await depositHost.reconcileDeposit(payload);
      }
      if (Object.keys(payload).join() !== "preparedId" || typeof payload.preparedId !== "string") fail2();
      return await depositHost[command]({ preparedId: payload.preparedId });
    } finally {
      depositAction = false;
    }
  }
  if (command === "recoverNotes") {
    if (Object.keys(payload).length) fail2();
    const cache = balanceCache;
    const summary = await enhanced.recoverNotes({ displayCache: cache });
    live();
    await cache?.saveSnapshot(summary).catch(() => {
    });
    return summary;
  }
  if (command === "exportRecoveryBackup") {
    if (Object.keys(payload).length) fail2();
    return enhanced.exportRecoveryBackup();
  }
  if (command === "importRecoveryBackup") {
    if (Object.keys(payload).join() !== "backup" || !payload.backup || typeof payload.backup !== "object" || Array.isArray(payload.backup) || JSON.stringify(payload.backup).length > 32 * 1024 * 1024 + 4096) fail2();
    return enhanced.importRecoveryBackup(payload.backup);
  }
  if (["quotePublicBatch", "prepareReviewedPublicBatch", "authorizePublicBatch", "monitorPublicBatch"].includes(command)) {
    privateSendAction = true;
    try {
      if (command === "quotePublicBatch") {
        if (Object.keys(payload).sort().join() !== "partnerHandle,payments" || typeof payload.partnerHandle !== "string" || !Array.isArray(payload.payments)) fail2();
        return await (await withdrawalHost()).quoteBatch({ payments: payload.payments, partnerHandle: payload.partnerHandle });
      }
      if (command === "prepareReviewedPublicBatch") {
        if (Object.keys(payload).join() !== "quoteId" || typeof payload.quoteId !== "string") fail2();
        const review = await (await withdrawalHost()).prepareReviewed({ quoteId: payload.quoteId, batch: true });
        if (!review.batch) fail2();
        return { intentId: review.preparedId, review };
      }
      if (command === "authorizePublicBatch") {
        if (Object.keys(payload).join() !== "intentId" || typeof payload.intentId !== "string") fail2();
        return normalBatchActivity(await (await withdrawalHost()).execute({ preparedId: payload.intentId, batch: true }));
      }
      if (Object.keys(payload).join() !== "transactionId" || typeof payload.transactionId !== "string") fail2();
      if (payload.transactionId.startsWith("send_")) {
        return normalBatchActivity(await (await (history ? history.withdrawal() : withdrawalHost())).reconcile({ preparedId: payload.transactionId, batch: true })).status;
      }
      return await (history ? await history.enhanced() : enhanced).publicBatch.monitor({ transactionId: payload.transactionId });
    } finally {
      privateSendAction = false;
    }
  }
  if (["quoteWithdrawal", "prepareReviewedWithdrawal", "authorizeWithdrawal", "listWithdrawals", "monitorWithdrawal"].includes(command)) {
    privateSendAction = true;
    try {
      const normalWithdrawal = () => history ? history.withdrawal() : withdrawalHost();
      if (command === "quoteWithdrawal") {
        if (Object.keys(payload).sort().join() !== "amountAtomic,destination,enhanced,partnerHandle" || typeof payload.enhanced !== "boolean" || typeof payload.destination !== "string" || typeof payload.amountAtomic !== "string" || typeof payload.partnerHandle !== "string") fail2();
        const q = payload.enhanced ? await enhanced.quoteWithdrawal(payload) : await (await normalWithdrawal()).quote({ recipient: payload.destination, amountAtomic: payload.amountAtomic, partnerHandle: payload.partnerHandle });
        if (withdrawalQuotes.size >= 4) withdrawalQuotes.delete(withdrawalQuotes.keys().next().value);
        withdrawalQuotes.set(q.quoteId, payload.enhanced);
        if (payload.enhanced) return q;
        if (!("amountAtomic" in q) || !("deadline" in q)) fail2();
        return { ...q, netPayoutAtomic: q.amountAtomic, asset: enhanced.host.context.assetSymbol, destination: payload.destination, enhanced: false, windowSeconds: 0, expiresAt: q.deadline };
      }
      if (command === "prepareReviewedWithdrawal") {
        if (Object.keys(payload).join() !== "quoteId" || typeof payload.quoteId !== "string" || !withdrawalQuotes.has(payload.quoteId)) fail2();
        const isEnhanced = withdrawalQuotes.get(payload.quoteId);
        withdrawalQuotes.delete(payload.quoteId);
        if (isEnhanced) return enhanced.prepareReviewedWithdrawal({ quoteId: payload.quoteId });
        const review = await (await normalWithdrawal()).prepareReviewed({ quoteId: payload.quoteId });
        return { intentId: review.preparedId, enhanced: false, review };
      }
      if (command === "authorizeWithdrawal") {
        if (Object.keys(payload).sort().join() !== "enhanced,intentId" || typeof payload.intentId !== "string" || typeof payload.enhanced !== "boolean") fail2();
        return await (payload.enhanced ? enhanced.host.authorize({ intentId: payload.intentId }) : (await normalWithdrawal()).execute({ preparedId: payload.intentId }));
      }
      const publicWithdrawal2 = await normalWithdrawal();
      if (command === "listWithdrawals") {
        if (Object.keys(payload).length && !(Object.keys(payload).join() === "cached" && payload.cached === true)) fail2();
        const cached = payload.cached === true;
        const historyHost = history ? await history.enhanced() : enhanced;
        const [enhancedRows, withdrawalRows, batchRows] = await Promise.all([
          cached ? historyHost.host.listSaved() : historyHost.host.list(),
          publicWithdrawal2.list(),
          cached ? historyHost.publicBatch.listSaved() : historyHost.publicBatch.list()
        ]);
        return [
          ...enhancedRows.map((row) => ({ ...row, enhanced: true })),
          ...batchRows.map((row) => ({ ...row, enhanced: false, batch: true })),
          ...withdrawalRows.filter((row) => !["proving", "prepared", "failed", "cancelled", "expired-unused"].includes(row.phase)).map((row) => row.batch ? normalBatchActivity(row) : {
            transactionId: row.preparedId,
            enhanced: false,
            amountAtomic: row.amountAtomic,
            totalDebitAtomic: row.totalDebitAtomic,
            status: {
              authorized: ["included", "finalized"].includes(row.phase),
              authorizationFailed: row.phase === "failed-finalized",
              finalized: row.phase === "finalized",
              transactionHash: row.transactionHash
            }
          })
        ];
      }
      if (Object.keys(payload).sort().join() !== "enhanced,transactionId" || typeof payload.transactionId !== "string" || typeof payload.enhanced !== "boolean") fail2();
      return payload.enhanced ? (history ? await history.enhanced() : enhanced).host.monitor({ transactionId: payload.transactionId }) : publicWithdrawal2.reconcile({ preparedId: payload.transactionId });
    } finally {
      privateSendAction = false;
    }
  }
  if (command === "list") {
    if (Object.keys(payload).length && !(Object.keys(payload).join() === "cached" && payload.cached === true)) fail2();
    return payload.cached === true ? enhanced.host.listSaved() : enhanced.host.list();
  }
  if (command === "prepare") {
    if (Object.keys(payload).sort().join() !== "amountAtomic,destination" || typeof payload.amountAtomic !== "string" || typeof payload.destination !== "string") fail2();
    return enhanced.host.prepare(payload);
  }
  if (command === "cancel") {
    if (Object.keys(payload).join() !== "intentId" || typeof payload.intentId !== "string") fail2();
    const cancel = enhanced.host.cancel;
    if (typeof cancel !== "function") fail2();
    return cancel.call(enhanced.host, { intentId: payload.intentId });
  }
  if (command === "authorize") {
    if (Object.keys(payload).join() !== "intentId" || typeof payload.intentId !== "string") fail2();
    return enhanced.host.authorize({ intentId: payload.intentId });
  }
  if (command === "monitor" || command === "recover") {
    if (Object.keys(payload).join() !== "transactionId" || typeof payload.transactionId !== "string") fail2();
    return enhanced.host[command]({ transactionId: payload.transactionId });
  }
  fail2();
}
var lastId = 0;
scope.addEventListener("message", async ({ data, ports }) => {
  if (!data || !Number.isSafeInteger(data.id) || data.id <= lastId || busy) return;
  lastId = data.id;
  busy = true;
  const revision = epoch;
  try {
    const result = data.kind === "initialize" ? await initialize(data.config, ports[0]) : data.kind === "invoke" && data.payload && typeof data.payload === "object" && !Array.isArray(data.payload) ? await invokeScoped(data.command, data.payload) : fail2();
    live(revision);
    scope.postMessage({ kind: "result", id: data.id, result });
    if (data.command === "quoteWithdrawal" && data.payload?.enhanced === true) {
      setTimeout(() => {
        if (!controller.signal.aborted && revision === epoch) void publicArtifacts?.warmEnhanced().catch(() => {
        });
      }, 0);
    }
  } catch (error) {
    if (["prepareReviewedPrivateSend", "preparePrivateSend"].includes(data.command)) {
      privateSend?.dispose();
      privateSend = void 0;
    }
    if (["prepareReviewedRoute", "prepareRoute"].includes(data.command)) {
      const op = data.payload?.operation;
      if (op === 4 || op === 5) {
        routedHosts.get(op)?.dispose();
        routedHosts.delete(op);
      }
    }
    if (["prepareReviewedWithdrawal", "prepareReviewedPublicBatch"].includes(data.command)) {
      publicWithdrawal?.dispose();
      publicWithdrawal = void 0;
    }
    const stages = { selectAsset: "Wallet asset", claimHandle: "Handle claim", checkHandle: "Handle status", findHandle: "Handle recovery", handleAvailable: "Handle availability", currentHandle: "Handle recovery", openPublicPayment: "Wallet session", reconcileDeposit: "Deposit status", quotePrivateSend: "Transfer fee review", prepareReviewedPrivateSend: "Transfer preparation", preparePrivateSend: "Transfer preparation", quoteRouteFees: "Route fee review", prepareReviewedRoute: "Route preparation", prepareRoute: "Route preparation", quotePublicBatch: "Batch fee review", prepareReviewedPublicBatch: "Batch preparation", authorizePublicBatch: "Batch submission", quoteWithdrawal: "Withdrawal fee review", prepareReviewedWithdrawal: "Withdrawal preparation", prepare: "Withdrawal preparation", authorize: "Transaction authorization", authorizeWithdrawal: "Transaction authorization", executePrivateSend: "Transaction authorization", executeRoute: "Transaction authorization" };
    if (stages[data.command]) error = depositFailure(error?.cause ?? error, stages[data.command]);
    const code = error?.code;
    const hasBackup = await backend?.hasRecoveryPhrase().catch(() => false) ?? false;
    scope.postMessage({
      kind: "error",
      id: data.id,
      code: typeof code === "string" && /^[A-Z_]{1,64}$/u.test(code) ? code : "RUNTIME_UNAVAILABLE",
      hasBackup,
      depositFailure: publicDepositFailure(error)
    });
    if (data.kind === "initialize") dispose();
  } finally {
    busy = false;
  }
});
