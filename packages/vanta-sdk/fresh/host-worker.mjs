/** Versioned, device-local transport for a trusted SDK/prover worker.
 * This is not a MyDoge native binding or an activated DogeOS runtime. The host
 * must supply a bundled Worker, verified runtime and its own secure vault UI.
 * No phrase, witness, arbitrary RPC method or executable URL crosses here. */
const VERSION = "stealthos-local-host-v1";
const COMMANDS = Object.freeze([
  "status", "createWallet", "unlockWallet", "restoreWallet", "backupWallet",
  "recover", "reconcile", "deposit", "privateSend", "withdraw", "swap", "bridge",
]);
const WRITES = Object.freeze(["deposit", "privateSend", "withdraw", "swap", "bridge"]);
const WALLET_CHANGES = Object.freeze(["createWallet", "unlockWallet", "restoreWallet"]);
const STAGES = new Set([
  "initializing", "unlocking", "recovering", "loading-artifacts", "proving",
  "awaiting-approval", "submitting", "reconciling", "settling", "complete",
]);
const PHASES = new Set([
  "idle", "prepared", "reserved", "proving", "awaiting-approval",
  "broadcast-uncertain", "submitted", "included", "finalized", "expired-unused",
  "destination-pending", "delivered", "failed", "reconciliation-required",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const NETWORK = /^eip155:[1-9][0-9]*$/u;
const UNITS = /^(0|[1-9][0-9]{0,77})$/u;
const ERRORS = Object.freeze({
  ABORTED: "Local operation cancelled. Reconcile before submitting again.",
  LOCKED: "Private wallet locked.",
  BACKGROUNDED: "Privacy worker stopped while the application is backgrounded.",
  CONTEXT_CHANGED: "Active wallet or network changed.",
  TERMINATED: "Privacy worker terminated. Restart and reconcile.",
  TIMEOUT: "Privacy worker timed out. Restart and reconcile.",
  WORKER_ERROR: "Privacy worker failed. Restart and reconcile.",
  INVALID_MESSAGE: "Privacy worker returned an invalid message.",
  INVALID_REQUEST: "Invalid local privacy command.",
  INVALID_RESULT: "Privacy runtime returned an invalid result.",
  RUNTIME_UNAVAILABLE: "A verified local privacy runtime is unavailable.",
  OPERATION_FAILED: "Local privacy operation failed. Reconcile before retrying.",
  USER_REJECTED: "Wallet approval was declined.",
  UNSUPPORTED_OPERATION: "This runtime has not implemented that operation.",
  RECONCILIATION_REQUIRED: "Reconcile pending operations before submitting.",
  BUSY: "Another privacy operation is in progress.",
  NOT_READY: "Start the verified privacy worker first.",
  DISPOSED: "This privacy worker controller has been disposed.",
});

export class VantaHostWorkerError extends Error {
  constructor(code) {
    super(ERRORS[code] ?? ERRORS.OPERATION_FAILED);
    this.name = "VantaHostWorkerError";
    this.code = Object.hasOwn(ERRORS, code) ? code : "OPERATION_FAILED";
  }
}

function fail(code = "INVALID_REQUEST") { throw new VantaHostWorkerError(code); }
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
function keys(value, allowed, required = []) {
  return object(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key));
}
function context(value) {
  if (!keys(value, ["accountId", "networkId", "generationId"],
    ["accountId", "networkId", "generationId"]) ||
    ["accountId", "networkId", "generationId"].some(key => typeof value[key] !== "string") ||
    !ID.test(value.accountId) ||
    !NETWORK.test(value.networkId) || !HASH.test(value.generationId) ||
    BigInt(value.generationId) === 0n) fail();
  return Object.freeze({accountId: value.accountId,
    networkId: value.networkId, generationId: value.generationId.toLowerCase()});
}
const sameContext = (left, right) => left.accountId === right.accountId &&
  left.networkId === right.networkId && left.generationId === right.generationId;
const name = value => typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u.test(value);
const recipient = value => typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u.test(value);
function command(commandName, payload = {}) {
  if (!COMMANDS.includes(commandName)) fail();
  const common = ["partnerHandle", "maxFeeUnits"];
  const fields = commandName === "swap" ?
    ["fromAsset", "toAsset", "amountUnits", "minimumOutputUnits", "routeId", "deadline", ...common] :
    commandName === "bridge" ?
      ["asset", "amountUnits", "recipient", "destinationNetworkId", "routeId", ...common] :
      WRITES.includes(commandName) ?
        ["asset", "amountUnits", ...(commandName === "deposit" ? [] : ["recipient"]), ...common] : [];
  const required = WRITES.includes(commandName) ?
    fields.filter(key => !common.includes(key) && key !== "deadline") : [];
  if (!keys(payload, fields, required)) fail();
  for (const [key, value] of Object.entries(payload)) {
    const valid = key.endsWith("Units") ? typeof value === "string" && UNITS.test(value) :
      key === "deadline" ? Number.isSafeInteger(value) && value > 0 :
        key === "destinationNetworkId" ? typeof value === "string" && NETWORK.test(value) :
          key === "recipient" ? recipient(value) : name(value);
    if (!valid) fail();
  }
  if (WRITES.includes(commandName) && payload.amountUnits === "0") fail();
  return Object.freeze({...payload});
}
function progress(value) {
  if (!keys(value, ["stage", "fraction"], ["stage"]) ||
    !STAGES.has(value.stage) ||
    (value.fraction !== undefined && (typeof value.fraction !== "number" ||
      !Number.isFinite(value.fraction) || value.fraction < 0 || value.fraction > 1)))
    fail("INVALID_RESULT");
  return Object.freeze({...value});
}
function result(value, operation) {
  const fields = ["walletReady", "backupConfirmed", "reconciled", "operationId",
    "phase", "transactionHash", "destinationTransactionHash", "messageId",
    "balances", "pendingOperations"];
  if (!keys(value, fields)) fail("INVALID_RESULT");
  for (const [key, entry] of Object.entries(value)) {
    let valid;
    if (["walletReady", "backupConfirmed", "reconciled"].includes(key))
      valid = typeof entry === "boolean";
    else if (key === "operationId") valid = typeof entry === "string" && ID.test(entry);
    else if (key === "phase") valid = PHASES.has(entry);
    else if (["transactionHash", "destinationTransactionHash", "messageId"].includes(key))
      valid = typeof entry === "string" && HASH.test(entry);
    else if (key === "balances") valid = Array.isArray(entry) && entry.length <= 128 &&
      entry.every(item => keys(item, ["asset", "spendableUnits", "pendingUnits"],
        ["asset", "spendableUnits", "pendingUnits"]) && name(item.asset) &&
        typeof item.spendableUnits === "string" && UNITS.test(item.spendableUnits) &&
        typeof item.pendingUnits === "string" && UNITS.test(item.pendingUnits));
    else if (key === "pendingOperations") valid = Array.isArray(entry) && entry.length <= 1000 &&
      entry.every(item => keys(item, ["operationId", "phase", "transactionHash"],
        ["operationId", "phase"]) && typeof item.operationId === "string" &&
        ID.test(item.operationId) && PHASES.has(item.phase) &&
        (item.transactionHash === undefined ||
          typeof item.transactionHash === "string" && HASH.test(item.transactionHash)));
    if (!valid) fail("INVALID_RESULT");
  }
  const ensureResult = valid => { if (!valid) fail("INVALID_RESULT"); };
  if (operation === "status") ensureResult(typeof value.walletReady === "boolean");
  if (WALLET_CHANGES.includes(operation)) ensureResult(value.walletReady === true);
  if (operation === "backupWallet") ensureResult(value.backupConfirmed === true);
  if (operation === "recover") ensureResult(value.walletReady === true && Array.isArray(value.balances));
  if (operation === "reconcile") {
    if (value.reconciled !== true) fail("RECONCILIATION_REQUIRED");
  }
  if (WRITES.includes(operation)) {
    ensureResult(typeof value.operationId === "string" && value.phase !== undefined && value.phase !== "idle");
    if (["submitted", "included", "finalized", "destination-pending", "delivered"].includes(value.phase))
      ensureResult(typeof value.transactionHash === "string");
    if (["destination-pending", "delivered"].includes(value.phase))
      ensureResult(operation === "bridge" && typeof value.messageId === "string");
    if (value.phase === "delivered") ensureResult(typeof value.destinationTransactionHash === "string");
  }
  // Validate, then copy. Never silently discard unexpected secret-bearing fields.
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, Array.isArray(entry) ? Object.freeze(entry.map(item => Object.freeze({...item}))) : entry])));
}
function capabilities(value) {
  if (!Array.isArray(value) || value.length > COMMANDS.length ||
    new Set(value).size !== value.length ||
    !value.includes("reconcile") || value.some(item => !COMMANDS.includes(item)))
    fail("RUNTIME_UNAVAILABLE");
  return Object.freeze([...value]);
}
// Shared wire validators for the endpoint. These are not proof verification.
export const vantaHostWorkerProtocol = Object.freeze({VERSION, COMMANDS, WRITES,
  WALLET_CHANGES, ERRORS, object, keys, context, sameContext, command,
  progress, result, capabilities});

/** createWorker must return a NEW trusted local module Worker on each call.
 * Never wrap a remote service in this interface. Stopping during broadcast does
 * not undo a transaction: the durable runtime journal must reconcile on restart. */
export function createVantaHostWorker({createWorker, context: initialContext,
  timeoutMs = 120_000, onProgress} = {}) {
  if (typeof createWorker !== "function" || !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 || timeoutMs > 600_000 ||
    (onProgress !== undefined && typeof onProgress !== "function")) fail();
  let activeContext = context(initialContext), worker = null, pending = null;
  let phase = "stopped", sequence = 0, epoch = 0, reconciled = false;
  let implemented = Object.freeze([]), disposed = false;
  let detach = () => {};
  const snapshot = () => Object.freeze({phase, context: activeContext,
    needsReconciliation: !reconciled, capabilities: implemented});
  function settle(error, value) {
    const current = pending;
    if (!current) return;
    pending = null;
    clearTimeout(current.timer);
    current.signal?.removeEventListener("abort", current.abort);
    if (error) current.reject(error); else current.resolve(value);
  }
  function stop(code = "TERMINATED") {
    // Remove listeners before terminating, so errors from the obsolete worker
    // cannot invalidate a replacement worker or reveal a stale response.
    const previous = worker;
    worker = null; epoch++;
    try { detach(); } catch { /* A broken host listener must not prevent termination. */ }
    detach = () => {};
    phase = disposed ? "disposed" : "stopped";
    reconciled = false; implemented = Object.freeze([]);
    try { previous?.terminate(); } catch { /* Already terminated. */ }
    settle(new VantaHostWorkerError(code));
  }
  function send(operation, payload, signal) {
    if (signal?.aborted) return Promise.reject(new VantaHostWorkerError("ABORTED"));
    if (pending) return Promise.reject(new VantaHostWorkerError("BUSY"));
    return new Promise((resolve, reject) => {
      const id = ++sequence, session = epoch;
      const abort = () => stop("ABORTED");
      pending = {id, session, operation, resolve, reject, signal, abort,
        timer: setTimeout(() => stop("TIMEOUT"), timeoutMs)};
      signal?.addEventListener("abort", abort, {once: true});
      if (signal?.aborted) { abort(); return; }
      try { worker.postMessage({version: VERSION, type: "request", session, id,
        context: activeContext, operation, payload}); }
      catch { stop("WORKER_ERROR"); }
    });
  }
  async function start({signal} = {}) {
    if (disposed) fail("DISPOSED");
    if (worker || pending) fail("BUSY");
    if (signal?.aborted) fail("ABORTED");
    let created;
    try { created = createWorker(); } catch { fail("WORKER_ERROR"); }
    if (!created || typeof created.postMessage !== "function" ||
      typeof created.terminate !== "function" ||
      typeof created.addEventListener !== "function" ||
      typeof created.removeEventListener !== "function") {
      try { created?.terminate?.(); } catch { /* Invalid factory. */ }
      fail("WORKER_ERROR");
    }
    worker = created; epoch++; phase = "initializing";
    const session = epoch;
    const message = event => {
      if (worker !== created || session !== epoch) return;
      const data = event.data;
      if (!object(data) || data.version !== VERSION || data.session !== session ||
        !Number.isSafeInteger(data.id)) { stop("INVALID_MESSAGE"); return; }
      // A completed request cannot mutate state when its late response arrives.
      if (!pending || data.id !== pending.id) return;
      try {
        if (data.type === "progress") {
          if (!keys(data, ["version", "type", "session", "id", "progress"],
            ["version", "type", "session", "id", "progress"])) fail("INVALID_MESSAGE");
          const update = progress(data.progress);
          try { onProgress?.(Object.freeze({operation: pending.operation, ...update})); }
          catch { /* A UI callback must not affect proof or journal state. */ }
          return;
        }
        if (data.type === "error") {
          if (!keys(data, ["version", "type", "session", "id", "code"],
            ["version", "type", "session", "id", "code"]) ||
            !Object.hasOwn(ERRORS, data.code)) fail("INVALID_MESSAGE");
          stop(data.code); return;
        }
        if (data.type !== "result" ||
          !keys(data, ["version", "type", "session", "id", "result"],
            ["version", "type", "session", "id", "result"])) fail("INVALID_MESSAGE");
        if (pending.operation === "initialize") {
          const ready = data.result;
          if (!keys(ready, ["verified", "context", "capabilities"],
            ["verified", "context", "capabilities"]) || ready.verified !== true ||
            !sameContext(context(ready.context), activeContext)) fail("RUNTIME_UNAVAILABLE");
          implemented = capabilities(ready.capabilities); phase = "ready";
          settle(null, snapshot());
        } else {
          const value = result(data.result, pending.operation);
          if (pending.operation === "reconcile") {
            if (value.reconciled !== true) fail("RECONCILIATION_REQUIRED");
            reconciled = true;
          } else if (WALLET_CHANGES.includes(pending.operation) || WRITES.includes(pending.operation))
            reconciled = false;
          settle(null, value);
        }
      } catch (error) { stop(error instanceof VantaHostWorkerError ? error.code : "INVALID_MESSAGE"); }
    };
    const broken = () => { if (worker === created) stop("WORKER_ERROR"); };
    created.addEventListener("message", message);
    created.addEventListener("error", broken);
    created.addEventListener("messageerror", broken);
    detach = () => {
      created.removeEventListener("message", message);
      created.removeEventListener("error", broken);
      created.removeEventListener("messageerror", broken);
    };
    return send("initialize", {}, signal);
  }
  return Object.freeze({
    start,
    state: snapshot,
    async request(operation, payload = {}, {signal} = {}) {
      if (disposed) fail("DISPOSED");
      if (phase !== "ready" || !worker) fail("NOT_READY");
      const checked = command(operation, payload);
      if (!implemented.includes(operation)) fail("UNSUPPORTED_OPERATION");
      if (WRITES.includes(operation) && !reconciled) fail("RECONCILIATION_REQUIRED");
      return send(operation, checked, signal);
    },
    stop(reason = "TERMINATED") {
      if (!["LOCKED", "BACKGROUNDED", "CONTEXT_CHANGED", "TERMINATED", "ABORTED"].includes(reason)) fail();
      stop(reason);
    },
    changeContext(next) {
      if (disposed) fail("DISPOSED");
      const checked = context(next);
      stop("CONTEXT_CHANGED"); activeContext = checked;
    },
    dispose() { disposed = true; stop("DISPOSED"); },
  });
}
