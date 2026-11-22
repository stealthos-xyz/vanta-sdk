/** Internal host state machine. Public construction supplies the compiled
 * release gate; this module is not an exported package subpath or MCP surface. */
import { getAddress, sha256, toUtf8Bytes } from "ethers";
import { createEnhancedPayoutSchedule } from "./enhanced-payouts.mjs";

const MAX = (1n << 120n) - 1n;
const ZERO = "0x" + "00".repeat(20);
const WORD = /^0x[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ACTIONS = ["prepare", "authorize", "monitor", "recover", "cancel"];
const STATES = ["waiting", "prepared", "submitted", "included", "finalized", "recovery"];
const PHASES = ["prepared", "cancel_pending", "cancelled", "authorizing", "uncertain", "tracking", "failed"];
const CODES = ["INVALID_ARGUMENT", "NOT_READY", "PERMISSION_DENIED", "SESSION_EXPIRED",
  "INTENT_NOT_FOUND", "INTENT_EXPIRED", "AUTHORIZATION_UNCERTAIN", "AUTHORIZATION_ALREADY_ATTEMPTED",
  "STORE_UNAVAILABLE", "RUNTIME_UNAVAILABLE", "INVALID_REVIEW", "INVALID_STATUS", "STATE_CHANGED"];
const hosts = new WeakSet();

export class EnhancedWithdrawalHostError extends Error {
  constructor(code) {
    super("Enhanced withdrawal host rejected the request.");
    this.name = "EnhancedWithdrawalHostError";
    this.code = CODES.includes(code) ? code : "INVALID_ARGUMENT";
  }
}
const fail = code => { throw new EnhancedWithdrawalHostError(code); };
const safe = (error, fallback) => error instanceof EnhancedWithdrawalHostError
  ? error : new EnhancedWithdrawalHostError(fallback);
export function enhancedExact(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Reflect.ownKeys(value).some(key => !required.includes(key) && !optional.includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => d.get || d.set)) fail("INVALID_ARGUMENT");
}
const dense = (value, count) => {
  if (!Array.isArray(value) || value.length !== count || Reflect.ownKeys(value).length !== count + 1 ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => d.get || d.set)) fail("INVALID_ARGUMENT");
};
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => sha256(toUtf8Bytes(JSON.stringify(canonical(value))));
const id = value => {
  if (typeof value !== "string" || !ID.test(value)) fail("INVALID_ARGUMENT");
  return value;
};
const integer = value => {
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_ARGUMENT");
  return value;
};
const atomic = (value, zero = false) => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,36})$/u.test(value)) fail("INVALID_ARGUMENT");
  const amount = BigInt(value);
  if (amount > MAX || (!zero && amount === 0n)) fail("INVALID_ARGUMENT");
  return amount;
};
const address = (value, zero = false) => {
  let result;
  try { result = getAddress(value); } catch { fail("INVALID_ARGUMENT"); }
  if (!zero && result === ZERO) fail("INVALID_ARGUMENT");
  return result;
};
function contextOf(raw) {
  enhancedExact(raw, ["networkId", "generationId", "pool", "assetAddress", "assetSymbol", "assetDecimals"]);
  if (typeof raw.networkId !== "string" || !/^eip155:[1-9][0-9]{0,15}$/u.test(raw.networkId) ||
      !Number.isSafeInteger(Number(raw.networkId.slice(7))) || !WORD.test(raw.generationId) ||
      BigInt(raw.generationId) === 0n || typeof raw.assetSymbol !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/u.test(raw.assetSymbol) || integer(raw.assetDecimals) > 36)
    fail("INVALID_ARGUMENT");
  return freeze({ networkId: raw.networkId, generationId: raw.generationId,
    pool: address(raw.pool), assetAddress: address(raw.assetAddress, true),
    assetSymbol: raw.assetSymbol, assetDecimals: raw.assetDecimals });
}
function inputOf(raw, context) {
  enhancedExact(raw, ["amountAtomic", "destination"]);
  const amount = atomic(raw.amountAtomic), destination = address(raw.destination);
  if (amount < 3n || destination === context.pool) fail("INVALID_ARGUMENT");
  return freeze({ amountAtomic: amount.toString(), destination });
}
function sessionOf(raw, now) {
  enhancedExact(raw, ["subjectId", "sessionId", "expiresAt", "permissions", "maximumDebitAtomic",
    "maximumSessionDebitAtomic", "allowedDestinations"]);
  const subjectId = id(raw.subjectId), sessionId = id(raw.sessionId);
  if (integer(raw.expiresAt) <= now) fail("SESSION_EXPIRED");
  dense(raw.permissions, raw.permissions?.length);
  if (raw.permissions.some(value => !ACTIONS.includes(value)) || new Set(raw.permissions).size !== raw.permissions.length)
    fail("INVALID_ARGUMENT");
  const maximumDebit = atomic(raw.maximumDebitAtomic), maximumSessionDebit = atomic(raw.maximumSessionDebitAtomic);
  if (raw.allowedDestinations !== null) dense(raw.allowedDestinations, raw.allowedDestinations?.length);
  return { subjectId, sessionId, expiresAt: raw.expiresAt, permissions: [...raw.permissions], maximumDebit,
    maximumSessionDebit, destinations: raw.allowedDestinations === null ? null : raw.allowedDestinations.map(value => address(value)) };
}
function reviewOf(raw, expected) {
  enhancedExact(raw, ["intentId", "netPayoutAtomic", "protocolFeeAtomic", "partnerFeeAtomic", "gasReserveAtomic",
    "totalDebitAtomic", "asset", "windowSeconds", "expiresAt"]);
  const net = atomic(raw.netPayoutAtomic), protocol = atomic(raw.protocolFeeAtomic, true);
  const partner = atomic(raw.partnerFeeAtomic, true), gas = atomic(raw.gasReserveAtomic, true);
  const total = atomic(raw.totalDebitAtomic);
  if (raw.intentId !== expected.intentId || net.toString() !== expected.input.amountAtomic ||
      net + protocol + partner + gas !== total || raw.asset !== expected.context.assetSymbol ||
      integer(raw.windowSeconds) !== expected.schedule.windowEpochs * 60 ||
      integer(raw.expiresAt) <= expected.createdAt || raw.expiresAt > expected.expiresAt)
    fail("INVALID_REVIEW");
  return freeze({ intentId: raw.intentId, netPayoutAtomic: net.toString(), protocolFeeAtomic: protocol.toString(),
    partnerFeeAtomic: partner.toString(), gasReserveAtomic: gas.toString(), totalDebitAtomic: total.toString(),
    asset: raw.asset, windowSeconds: raw.windowSeconds, expiresAt: raw.expiresAt });
}
function statusOf(raw) {
  enhancedExact(raw, ["completed", "total", "progress", "authorized", "authorizationFailed", "recoveryRequired", "claims"],["failure"]);
  if(raw.failure!==undefined&&(!raw.authorizationFailed||!["inputs-reserved","before-submission"].includes(raw.failure)))fail("INVALID_STATUS");
  dense(raw.claims, 3);
  const claims = raw.claims.map((claim, i) => {
    enhancedExact(claim, ["number", "state", "transactionHash"]);
    if (claim.number !== i + 1 || !STATES.includes(claim.state) ||
        (claim.transactionHash !== null && (!WORD.test(claim.transactionHash) || BigInt(claim.transactionHash) === 0n)) ||
        (claim.state === "submitted" && claim.transactionHash === null) ||
        (["waiting", "prepared"].includes(claim.state) && claim.transactionHash !== null)) fail("INVALID_STATUS");
    return { number: claim.number, state: claim.state, transactionHash: claim.transactionHash };
  });
  const completed = claims.filter(claim => claim.state === "finalized").length;
  if (raw.completed !== completed || raw.total !== 3 || raw.progress !== `${completed}/3` ||
      [raw.authorized, raw.authorizationFailed, raw.recoveryRequired].some(value => typeof value !== "boolean") ||
      (raw.authorized && raw.authorizationFailed) ||
      (!raw.authorized && claims.some(claim => ["included", "finalized"].includes(claim.state))) ||
      (raw.authorizationFailed && claims.some(claim => claim.state !== "waiting")) ||
      (claims.some(claim => claim.state === "recovery") && !raw.recoveryRequired)) fail("INVALID_STATUS");
  return freeze({ completed, total: 3, progress: `${completed}/3`, authorized: raw.authorized,
    authorizationFailed: raw.authorizationFailed, recoveryRequired: raw.recoveryRequired, claims,
    ...(raw.failure===undefined?{}:{failure:raw.failure}) });
}
const pending = uncertain => ({ completed: 0, total: 3, progress: "0/3", authorized: false,
  authorizationFailed: false, recoveryRequired: uncertain,
  claims: [1, 2, 3].map(number => ({ number, state: "waiting", transactionHash: null })) });

export const isEnhancedWithdrawalHost = host => hosts.has(host);

/** Runtime methods are trusted local wallet composition, never tool arguments.
 * The store must be the account-scoped encrypted durable CAS host adapter.
 * A returned public status must already have canonical receipt verification.
 */
export function createEnhancedWithdrawalHostCore(options, assertReady, now = () => Math.floor(Date.now() / 1000)) {
  enhancedExact(options, ["context", "store", "runtime", "getSession"]);
  const context = contextOf(options.context), { store, runtime, getSession } = options;
  if (!store || typeof store.read !== "function" || typeof store.transact !== "function" ||
      typeof store.scope !== "string" || !store.scope.startsWith("vanta-host-v1/") ||
      !store.scope.endsWith(`/${context.networkId}/${context.generationId}`) ||
      !runtime || ["getPolicy", "prepare", "cancelPrepared", "authorize", "monitor", "recover"].some(name => typeof runtime[name] !== "function") ||
      typeof getSession !== "function" || typeof assertReady !== "function") fail("INVALID_ARGUMENT");
  const namespace = `enhanced-withdrawals-v1/${context.pool.toLowerCase()}/${context.assetAddress.toLowerCase()}`;
  const contextHash = hash({ context, storageScope: store.scope });
  function guard(action) {
    const time = integer(now());
    let session;
    try { session = sessionOf(getSession(), time); } catch (error) { throw safe(error, "PERMISSION_DENIED"); }
    if (!session.permissions.includes(action)) fail("PERMISSION_DENIED");
    try { if (assertReady(context) !== undefined) fail("NOT_READY"); } catch { fail("NOT_READY"); }
    return session;
  }
  const sameSession = (action, previous) => {
    const current = guard(action);
    if (current.subjectId !== previous.subjectId || current.sessionId !== previous.sessionId) fail("SESSION_EXPIRED");
    return current;
  };
  const permissionHash = session => hash({ ...session,
    maximumDebit: session.maximumDebit.toString(), maximumSessionDebit: session.maximumSessionDebit.toString() });
  const permitted = (session, input, review) => {
    if ((session.destinations && !session.destinations.includes(input.destination)) ||
        (review && atomic(review.totalDebitAtomic) > session.maximumDebit)) fail("PERMISSION_DENIED");
  };
  const binding = row => hash({ schema: row.schema, contextHash, intentId: row.intentId,
    subjectId: row.subjectId, sessionId: row.sessionId, input: row.input, schedule: row.schedule,
    review: row.review, preparedId: row.preparedId, createdAt: row.createdAt });
  function rowsOf(rows) {
    if (!Array.isArray(rows) || rows.length > 4096) fail("STORE_UNAVAILABLE");
    dense(rows, rows.length);
    const seen = new Set();
    for (const row of rows) {
      enhancedExact(row, ["schema", "contextHash", "intentId", "subjectId", "sessionId", "input", "schedule",
        "review", "preparedId", "createdAt", "phase", "revision", "intentBinding", "status"]);
      if (row.schema !== "vanta-enhanced-host-intent-v1" || row.contextHash !== contextHash ||
          !PHASES.includes(row.phase) || seen.has(id(row.intentId)) || row.intentBinding !== binding(row)) fail("STORE_UNAVAILABLE");
      seen.add(row.intentId); id(row.subjectId); id(row.sessionId); id(row.preparedId);
      integer(row.revision); integer(row.createdAt); inputOf(row.input, context); statusOf(row.status);
      reviewOf(row.review, { ...row, context, expiresAt: row.review.expiresAt });
    }
    return rows;
  }
  async function read() {
    try { return rowsOf(await store.read(namespace)); } catch (error) { throw safe(error, "STORE_UNAVAILABLE"); }
  }
  async function update(work) {
    try { return await store.transact(namespace, rows => work(rowsOf(rows))); }
    catch (error) { throw safe(error, "STORE_UNAVAILABLE"); }
  }
  const owned = (rows, intentId, session) => {
    const row = rows.find(value => value.intentId === intentId);
    if (!row || row.subjectId !== session.subjectId) fail("INTENT_NOT_FOUND");
    return row;
  };
  const runtimeInput = row => freeze({ context, intentId: row.intentId, preparedId: row.preparedId,
    intentBinding: row.intentBinding, input: { ...row.input }, review: { ...row.review },
    schedule: structuredClone(row.schedule) });
  // A durable tombstone is committed BEFORE releasing a reserved note.
  // Interrupted cleanup is replayable, but no cancelled intent may sign.
  async function settleUnsignedCancellation(candidate, session) {
    let result;
    try { result = await runtime.cancelPrepared(runtimeInput(candidate)); }
    catch(error) { throw Object.assign(new EnhancedWithdrawalHostError("RUNTIME_UNAVAILABLE"),{cause:error}); }
    if (!result || result.released !== true || Object.keys(result).sort().join() !== "released")
      fail("RUNTIME_UNAVAILABLE");
    await update(rows => {
      const row = owned(rows, candidate.intentId, session);
      if (row.phase === "cancelled") return { next: rows, result: undefined };
      if (row.phase !== "cancel_pending") fail("STATE_CHANGED");
      const next = { ...row, phase: "cancelled", revision: row.revision + 1 };
      return { next: rows.map(value => value === row ? next : value), result: undefined };
    });
  }
  async function cleanupUnsignedReviews(session) {
    const time = now(), pending = (await read()).filter(row => row.subjectId === session.subjectId &&
      (row.phase === "cancel_pending" || row.phase === "prepared" && row.review.expiresAt <= time));
    for (const stale of pending) {
      const candidate = await update(rows => {
        const row = owned(rows, stale.intentId, session);
        if (row.phase === "cancelled") return { next: rows, result: null };
        if (row.phase === "prepared" && row.review.expiresAt <= now()) {
          const next = { ...row, phase: "cancel_pending", revision: row.revision + 1 };
          return { next: rows.map(value => value === row ? next : value), result: next };
        }
        if (row.phase !== "cancel_pending") fail("STATE_CHANGED");
        return { next: rows, result: row };
      });
      if (candidate) await settleUnsignedCancellation(candidate, session);
    }
  }
  async function refresh(intentId, action) {
    const session = guard(action), row = owned(await read(), intentId, session);
    if (["prepared", "cancel_pending", "cancelled"].includes(row.phase)) fail("AUTHORIZATION_ALREADY_ATTEMPTED");
    // Unknown authorization never calls an authorization/signature method.
    const method = action === "recover" && row.phase === "tracking" ? "recover" : "monitor";
    let observed;
    try {
      sameSession(action, session);
      observed = statusOf(await runtime[method](runtimeInput(row)));
    }
    catch (error) { throw safe(error, "RUNTIME_UNAVAILABLE"); }
    const result = await update(rows => {
      const current = owned(rows, intentId, session);
      if (current.revision !== row.revision) fail("STATE_CHANGED");
      // Canonical funding can disappear after an earlier inclusion. Missing
      // evidence cannot leave the fresh-intent authorization barrier open.
      const phase = observed.authorizationFailed ? "failed" : observed.authorized ? "tracking" : "uncertain";
      const status = (phase === "authorizing" || phase === "uncertain")
        ? statusOf({ ...observed, recoveryRequired: true }) : observed;
      const next = { ...current, phase, revision: current.revision + 1, status };
      return { next: rows.map(value => value === current ? next : value), result: status };
    });
    sameSession(action, session);
    return result;
  }
  const host = {
    context,
    getAvailability() {
      try { guard("prepare"); guard("authorize"); return freeze({ status: "ready" }); }
      catch (error) { return freeze({ status: "unqualified", reasonCode:
        error?.code === "SESSION_EXPIRED" ? "SESSION_EXPIRED" : error?.code === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "NOT_READY" }); }
    },
    async prepare(raw) {
      const session = guard("prepare"), input = inputOf(raw, context); permitted(session, input);
      // Reconcile interrupted and expired unsigned reservations before selecting
      // inputs for another quote. Failure leaves the old reservation fenced.
      await cleanupUnsignedReviews(session); sameSession("prepare", session);
      let policy;
      try { policy = await runtime.getPolicy(context); } catch(error) { throw Object.assign(new EnhancedWithdrawalHostError("RUNTIME_UNAVAILABLE"),{cause:error}); }
      enhancedExact(policy, ["windowEpochs", "minimumDelayEpochs", "maximumAuthorizationAgeEpochs", "reviewTtlSeconds"]);
      Object.values(policy).forEach(integer);
      if (policy.minimumDelayEpochs <= policy.maximumAuthorizationAgeEpochs || policy.reviewTtlSeconds < 1 ||
          policy.reviewTtlSeconds > 3600) fail("INVALID_REVIEW");
      const ready = sameSession("prepare", session);
      permitted(ready, input);
      const createdAt = integer(now());
      const schedule = createEnhancedPayoutSchedule({ netPayoutAtomic: input.amountAtomic, nowSeconds: createdAt,
        windowEpochs: policy.windowEpochs, minimumDelayEpochs: policy.minimumDelayEpochs });
      const expiresAt = Math.min(createdAt + policy.reviewTtlSeconds,
        (schedule.authorizationEpoch + policy.maximumAuthorizationAgeEpochs + 1) * 60, session.expiresAt);
      const entropy = new Uint8Array(16);
      try { globalThis.crypto.getRandomValues(entropy); } catch(error) { throw Object.assign(new EnhancedWithdrawalHostError("RUNTIME_UNAVAILABLE"),{cause:error}); }
      const intentId = "enh_" + Array.from(entropy, byte => byte.toString(16).padStart(2, "0")).join(""); entropy.fill(0);
      let prepared;
      try { prepared = await runtime.prepare(freeze({ context, intentId, input, schedule, expiresAt })); }
      catch(error) { throw Object.assign(new EnhancedWithdrawalHostError("RUNTIME_UNAVAILABLE"),{cause:error}); }
      enhancedExact(prepared, ["preparedId", "review"]);
      const review = reviewOf(prepared.review, { context, intentId, input, schedule, createdAt, expiresAt });
      const current = sameSession("prepare", session);
      if (review.expiresAt <= now()) fail("INTENT_EXPIRED");
      permitted(current, input, review);
      const row = { schema: "vanta-enhanced-host-intent-v1", contextHash, intentId, subjectId: session.subjectId,
        sessionId: session.sessionId, input, schedule, review, preparedId: id(prepared.preparedId), createdAt,
        phase: "prepared", revision: 0, status: pending(false) };
      row.intentBinding = binding(row);
      await update(rows => {
        if (rows.length >= 4096 || rows.some(value => value.intentId === intentId)) fail("STORE_UNAVAILABLE");
        return { next: [...rows, row], result: undefined };
      });
      sameSession("prepare", session);
      return review;
    },
    async cancel(raw) {
      enhancedExact(raw, ["intentId"]);
      const session = guard("cancel"), intentId = id(raw.intentId);
      const candidate = await update(rows => {
        const row = owned(rows, intentId, session);
        if (row.phase === "cancelled") return { next: rows, result: null };
        if (!["prepared", "cancel_pending"].includes(row.phase)) fail("AUTHORIZATION_ALREADY_ATTEMPTED");
        if (row.phase === "cancel_pending") return { next: rows, result: row };
        const next = { ...row, phase: "cancel_pending", revision: row.revision + 1 };
        return { next: rows.map(value => value === row ? next : value), result: next };
      });
      if (candidate) await settleUnsignedCancellation(candidate, session);
      return freeze({ cancelled: true });
    },
    async authorize(raw) {
      enhancedExact(raw, ["intentId"]); const intentId = id(raw.intentId), session = guard("authorize");
      // Only the compiled concrete runtime can establish exclusive ownership of
      // the exact input notes. Generic adapters retain the account-wide barrier.
      const candidate = owned(await read(), intentId, session);
      const isolated = candidate.phase === "prepared" && typeof runtime.assertAuthorizationIsolation === "function"
        ? await runtime.assertAuthorizationIsolation(runtimeInput(candidate)) === true : false;
      const lock = await update(rows => {
        const authority = sameSession("authorize", session);
        const row = owned(rows, intentId, session);
        if (row.phase === "authorizing" || row.phase === "uncertain") fail("AUTHORIZATION_UNCERTAIN");
        if (row.phase !== "prepared") fail("AUTHORIZATION_ALREADY_ATTEMPTED");
        if (row.sessionId !== session.sessionId) fail("PERMISSION_DENIED");
        if (row.review.expiresAt <= now()) fail("INTENT_EXPIRED");
        // Without concrete per-note isolation, ambiguity remains account-wide.
        // Isolated requests still include uncertain spends in the session budget.
        if (!isolated && rows.some(value => ["authorizing", "uncertain", "cancel_pending"].includes(value.phase))) fail("AUTHORIZATION_UNCERTAIN");
        permitted(authority, row.input, row.review);
        const reserved = rows.filter(value => value.subjectId === session.subjectId && value.sessionId === session.sessionId &&
          ["authorizing", "uncertain", "tracking"].includes(value.phase))
          .reduce((sum, value) => sum + atomic(value.review.totalDebitAtomic), 0n);
        if (reserved + atomic(row.review.totalDebitAtomic) > authority.maximumSessionDebit) fail("PERMISSION_DENIED");
        const next = { ...row, phase: "authorizing", revision: row.revision + 1, status: pending(true) };
        return { next: rows.map(value => value === row ? next : value),
          result: { row: next, permissionHash: permissionHash(authority) } };
      });
      const locked = lock.row;
      let observed;
      try {
        const current = sameSession("authorize", session);
        if (permissionHash(current) !== lock.permissionHash) fail("PERMISSION_DENIED");
        if (locked.review.expiresAt <= now()) fail("INTENT_EXPIRED");
        observed = statusOf(await runtime.authorize(runtimeInput(locked)));
      } catch {
        await update(rows => {
          const row = owned(rows, intentId, session);
          const next = row.phase === "authorizing" ? { ...row, phase: "uncertain", revision: row.revision + 1, status: pending(true) } : row;
          return { next: rows.map(value => value === row ? next : value), result: undefined };
        });
        fail("AUTHORIZATION_UNCERTAIN");
      }
      const status = await update(rows => {
        const row = owned(rows, intentId, session);
        // Preserve a newer canonical observation obtained while signing.
        const latest = row.revision === locked.revision ? observed : row.status;
        const phase = latest.authorizationFailed ? "failed" : latest.authorized ? "tracking" : "uncertain";
        const status = phase === "uncertain" ? statusOf({ ...latest, recoveryRequired: true }) : latest;
        const next = { ...row, phase, revision: row.revision + 1, status };
        return { next: rows.map(value => value === row ? next : value), result: status };
      });
      sameSession("authorize", session);
      return freeze({ transactionId: intentId, status });
    },
    async monitor(raw) {
      enhancedExact(raw, ["transactionId"]); return refresh(id(raw.transactionId), "monitor");
    },
    // Display-only last observed status. Funded operations never consult this
    // snapshot; monitor/recover still perform canonical transaction checks.
    async listSaved() {
      const session=guard('monitor'),rows=await read();sameSession('monitor',session);
      return freeze(rows.filter(row=>row.subjectId===session.subjectId&&!["prepared","cancel_pending","cancelled"].includes(row.phase))
        .map(row=>({transactionId:row.intentId,status:statusOf(row.status)})));
    },
    async list() {
      const session = guard("monitor"), rows = await read(), result = [];
      for (const row of rows) if (row.subjectId === session.subjectId && !["prepared", "cancel_pending", "cancelled"].includes(row.phase)) {
        let status;
        try { status = await refresh(row.intentId, "monitor"); }
        catch (error) {
          if (error?.code !== "RUNTIME_UNAVAILABLE") throw error;
          // Restart recovery must expose a durable intent even while its RPC
          // is unavailable. Never report cached settlement/finality as current.
          status = statusOf(pending(true));
        }
        sameSession("monitor", session);
        result.push({ transactionId: row.intentId, status });
      }
      return freeze(result);
    },
    async recover(raw) {
      enhancedExact(raw, ["transactionId"]); return refresh(id(raw.transactionId), "recover");
    },
  };
  hosts.add(host);
  return Object.freeze(host);
}
