import {VantaHostWorkerError, vantaHostWorkerProtocol as p} from "./host-worker.mjs";

/** Install only in a trusted, bundled, device-local worker. createRuntime must
 * verify the compiled family activation/deployment/artifact pins before returning
 * {verifiedContext, capabilities, execute, dispose}. The existing pinned fresh
 * WASM engine belongs inside that runtime; this file implements no cryptography.
 *
 * Wallet create/unlock/restore/backup handlers invoke trusted device vault UI.
 * They must never return private material or receive phrases through commands.
 * Every write must durably reserve its operation BEFORE any signing/broadcast.
 * Reconciliation must verify chain/relayer outcomes and not replay uncertain sends.
 * Capability declarations describe actually implemented handlers, not a roadmap.
 */
export function installVantaHostWorkerEndpoint({scope, createRuntime} = {}) {
  if (!scope || typeof scope.addEventListener !== "function" ||
    typeof scope.removeEventListener !== "function" ||
    typeof scope.postMessage !== "function" || typeof createRuntime !== "function")
    throw new VantaHostWorkerError("INVALID_REQUEST");
  let runtime = null, activeContext = null, session = null, lastId = 0;
  let busy = false, reconciled = false, disposed = false;
  let capabilities = Object.freeze([]), activeAbort = null;
  const post = (request, type, body) => {
    if (disposed) return;
    try { scope.postMessage({version: p.VERSION, type,
      session: request.session, id: request.id, ...body}); }
    catch {
      disposed = true; scope.removeEventListener("message", handler); cleanup();
    }
  };
  const cleanup = () => {
    activeAbort?.abort(); activeAbort = null;
    const current = runtime; runtime = null; reconciled = false;
    // Consume both synchronous and asynchronous cleanup failures without logging
    // exceptions that may contain a witness or native-store response.
    try { Promise.resolve(current?.dispose()).catch(() => {}); } catch { /* Local disposal. */ }
  };
  const handler = async event => {
    if (disposed) return;
    const request = event.data;
    if (!p.keys(request, ["version", "type", "session", "id", "context", "operation", "payload"],
      ["version", "type", "session", "id", "context", "operation", "payload"]) ||
      request.version !== p.VERSION || request.type !== "request" ||
      !Number.isSafeInteger(request.session) || request.session < 1 ||
      !Number.isSafeInteger(request.id) || request.id < 1) return;
    if (busy) { post(request, "error", {code: "BUSY"}); return; }
    busy = true;
    const controller = new AbortController(); activeAbort = controller;
    const reportProgress = value => {
      if (!disposed && !controller.signal.aborted)
        post(request, "progress", {progress: p.progress(value)});
    };
    try {
      const requestedContext = p.context(request.context);
      if (request.operation === "initialize") {
        if (session !== null || !p.keys(request.payload, []))
          throw new VantaHostWorkerError("INVALID_REQUEST");
        session = request.session; lastId = request.id; activeContext = requestedContext;
        const created = await createRuntime({context: activeContext,
          signal: controller.signal, reportProgress});
        if (disposed || controller.signal.aborted) {
          try { await created?.dispose?.(); } catch { /* Disposed during startup. */ }
          return;
        }
        runtime = created;
        if (!runtime || typeof runtime.execute !== "function" ||
          typeof runtime.dispose !== "function" ||
          !p.sameContext(p.context(runtime.verifiedContext), activeContext))
          throw new VantaHostWorkerError("RUNTIME_UNAVAILABLE");
        capabilities = p.capabilities(runtime.capabilities);
        post(request, "result", {result: {verified: true,
          context: activeContext, capabilities}});
        return;
      }
      if (!runtime || request.session !== session || request.id <= lastId ||
        !p.sameContext(requestedContext, activeContext))
        throw new VantaHostWorkerError("CONTEXT_CHANGED");
      lastId = request.id;
      const payload = p.command(request.operation, request.payload);
      if (!capabilities.includes(request.operation))
        throw new VantaHostWorkerError("UNSUPPORTED_OPERATION");
      if (p.WRITES.includes(request.operation) && !reconciled)
        throw new VantaHostWorkerError("RECONCILIATION_REQUIRED");
      // Even an unsuccessful or uncertain send consumes reconciliation readiness.
      if (p.WRITES.includes(request.operation) || p.WALLET_CHANGES.includes(request.operation))
        reconciled = false;
      const value = p.result(await runtime.execute(request.operation, payload,
        {signal: controller.signal, reportProgress}), request.operation);
      if (disposed || controller.signal.aborted) return;
      if (request.operation === "reconcile") {
        if (value.reconciled !== true)
          throw new VantaHostWorkerError("RECONCILIATION_REQUIRED");
        reconciled = true;
      }
      post(request, "result", {result: value});
    } catch (error) {
      const code = error instanceof VantaHostWorkerError ? error.code : "OPERATION_FAILED";
      cleanup(); post(request, "error", {code});
    } finally {
      if (activeAbort === controller) activeAbort = null;
      busy = false;
    }
  };
  scope.addEventListener("message", handler);
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true; scope.removeEventListener("message", handler); cleanup();
    },
  });
}
