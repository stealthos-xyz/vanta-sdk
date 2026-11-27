// browser/app-wallet.ts
import { depositWalletSubmissionCode, readDepositFailure, depositFailure, publicDepositFailure, uncertainDepositSubmission, DEPOSIT_SUBMISSION_REJECTED } from "../fresh/family-deposit-errors.mjs";
import { matchesFamilyDepositApproval } from "../fresh/family-deposit-approval.mjs";
import { encodeVantaFamilyReceivingAddress, decodeVantaFamilyReceivingAddress } from "../fresh/family-normal-address.mjs";
import { SDK_TRANSACTION_CONFIRMATIONS } from "../fresh/transaction-confirmations.mjs";
import { getAddress as getAddress3, getBytes, toBeHex, keccak256 as keccak2562, Interface } from "ethers";
import { getCompiledFamilyEvmRelease as getCompiledFamilyEvmRelease2 } from "../fresh/family-network.mjs";
import { getCompiledVantaFamilyProofResources } from "../fresh/family-proof-resources.mjs";
import { familyBridgeRoutes } from "../fresh/family-bridge-gateway.mjs";
import { parseCustomerHandleCalldata, normalizeVantaFamilyHandle } from "../fresh/family-customer-handles.mjs";
import { depositTransactionDigest } from "../fresh/family-deposit-host.mjs";

// browser/consent-signer.ts
import { getAddress as getAddress2, hexlify, toUtf8Bytes, verifyMessage } from "ethers";
import { getCompiledFamilyEvmRelease } from "../fresh/family-network.mjs";

// browser/consent-message.ts
import { getAddress, keccak256 } from "ethers";
var WORD = /^0x[0-9a-f]{64}$/u;
var ID = /^[A-Za-z0-9:_-]{8,128}$/u;
var BYTES = /^0x(?:[0-9a-f]{2})+$/u;
function fail() {
  throw Error("Enhanced consent does not match the compiled family release.");
}
function buildEnhancedConsentMessage(release, context, request, approvedIntentId) {
  if (!release || !context || !request || Object.keys(request).sort().join() !== "asset,calldata,intentId,pool,requestId" || !ID.test(request.requestId) || !ID.test(request.intentId) || request.intentId !== approvedIntentId || !release.setup?.family?.id || !/^eip155:[1-9][0-9]*$/u.test(release.pins.networkId) || release.activation.network.id !== release.pins.networkId || context.networkId !== release.pins.networkId || !WORD.test(release.setup.family.tag) || BigInt(release.setup.family.tag) === 0n || release.setup.family.tag !== release.activation.familyTag || release.setup.family.tag !== release.lock.familyTag || !WORD.test(release.pins.genesisHash) || BigInt(release.pins.genesisHash) === 0n || release.activation.network.genesisHash !== release.pins.genesisHash || !WORD.test(release.pins.generationId) || BigInt(release.pins.generationId) === 0n || release.pins.generationId !== context.generationId || !BYTES.test(request.calldata) || request.calldata.length > 512 * 1024) fail();
  let pool, asset;
  try {
    pool = getAddress(request.pool).toLowerCase();
    asset = getAddress(request.asset).toLowerCase();
    if (pool !== getAddress(context.pool).toLowerCase() || asset !== getAddress(context.assetAddress).toLowerCase() || !release.lock.contracts.some((contract) => contract.kind === "pool" && getAddress(contract.address).toLowerCase() === pool)) fail();
  } catch {
    fail();
  }
  return "Vanta private settlement authorization v1\n" + JSON.stringify([
    release.setup.family.tag,
    Number(release.pins.networkId.split(":")[1]),
    release.pins.genesisHash,
    release.pins.generationId,
    pool,
    asset,
    request.requestId,
    keccak256(request.calldata)
  ]);
}

// browser/consent-signer.ts
var SIGNATURE = /^0x[0-9a-f]{130}$/u;
var fail2 = () => {
  throw Error("Wallet authorization is unavailable for this reviewed intent.");
};
async function signCompiledEnhancedConsent({
  provider,
  wallet,
  intentId,
  request,
  context,
  assertCurrent
}) {
  await assertCurrent();
  const release = getCompiledFamilyEvmRelease();
  const message = buildEnhancedConsentMessage(release, context, request, intentId);
  const expected = getAddress2(wallet).toLowerCase();
  const [accounts, chainId] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" })
  ]);
  if (!Array.isArray(accounts) || accounts.length === 0 || getAddress2(String(accounts[0])).toLowerCase() !== expected || BigInt(chainId) !== BigInt(release.pins.networkId.split(":")[1])) fail2();
  await assertCurrent();
  const signed = await provider.request({
    method: "personal_sign",
    params: [hexlify(toUtf8Bytes(message)), expected]
  });
  const signature = typeof signed === "string" ? signed.toLowerCase() : "";
  if (!SIGNATURE.test(signature)) fail2();
  if (verifyMessage(message, signature).toLowerCase() !== expected) fail2();
  const [afterAccounts, afterChain] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" })
  ]);
  if (!Array.isArray(afterAccounts) || afterAccounts.length === 0 || getAddress2(String(afterAccounts[0])).toLowerCase() !== expected || BigInt(afterChain) !== BigInt(release.pins.networkId.split(":")[1])) fail2();
  await assertCurrent();
  return Object.freeze({ signature });
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
function assertFamilyRelayContext(routing, context) {
  if (!routing || routing.networkId !== context?.networkId || routing.generationId !== context?.generationId || routing.pool !== context?.pool?.toLowerCase()) throw Error("Family relay context changed.");
  return routing;
}

// browser/app-wallet.ts
function activityAsset(options) {
  return options.historyAsset === void 0 ? {} : { historyAsset: options.historyAsset };
}
var PATH = /^\/api\/vanta-v8\/(?:enhanced\/(session|quote|prepare|prepare-batch|terms|bind|bind-batch|sign|submit|monitor|recover|settlement)|deposit\/(route|clearance)|handles\/(submit|status)|(?:normal|routed)\/(gas|prequote|quote|submit|status)|routed\/(output-relayer|output-submit|output-status))$/u;
var unavailable = (code = "SESSION_EXPIRED") => Object.assign(Error(code === "NOT_READY" ? "The private wallet release is awaiting qualification." : code === "RUNTIME_UNAVAILABLE" ? "The private wallet could not be unlocked or its runtime could not be verified." : "Unlock the connected wallet to continue."), { code });
async function createStealthOSAppWallet(input) {
  if (!input.provider || typeof input.provider.request !== "function")
    throw Error("Open your already connected wallet before using its private balance.");
  const release = getCompiledFamilyEvmRelease2(), chainId = Number(release.pins.networkId.split(":")[1]), networkId = release.pins.networkId;
  const paymentRecipient = input.paymentRecipient ? decodeVantaFamilyReceivingAddress(encodeVantaFamilyReceivingAddress(input.paymentRecipient)) : void 0;
  const recipientAddress = paymentRecipient ? encodeVantaFamilyReceivingAddress(paymentRecipient) : void 0;
  const service = new URL(input.serviceUrl || window.location.origin);
  if (service.protocol !== "https:" || service.username || service.password || service.search || service.hash || service.pathname !== "/") throw Error("An HTTPS SDK service origin is required.");
  const origin = service.origin;
  const authorization = async () => {
    const token = await input.getSessionToken();
    if (typeof token !== "string" || token.length > 8192 || !token) throw unavailable();
    return "Bearer " + token;
  };
  if (new URL(origin).protocol !== "https:") throw Error("The private wallet requires HTTPS.");
  let worker = null, port = null, session = null;
  let sessionBearer = null;
  let disposed = false, openingWallet = false, revision = 0, nextId = 0, secretUi = null;
  let activeConsentIntentId = null, consentAttempted = false;
  let activeHandleName = null, handleSubmissionAttempted = false;
  const depositReviews = /* @__PURE__ */ new Map();
  const paymentQuotes = /* @__PURE__ */ new Map();
  const paymentApprovals = /* @__PURE__ */ new Map();
  let approvingPaymentAsset = false;
  let paymentContext = null;
  let activeDepositId = null, depositApprovalAttempted = false, depositApproved = false, depositSubmissionAttempted = false;
  const sendReviews = /* @__PURE__ */ new Map();
  let activeSendId = null, sendApproved = false, sendApprovalAttempted = false, sendSubmissionAttempted = false;
  const routeReviews = /* @__PURE__ */ new Map();
  let activeRouteId = null, routeApproved = false, routeApprovalAttempted = false, routeSubmissionAttempted = false;
  let historyRelayContext = null;
  let opened = null, expiry;
  let queue = Promise.resolve();
  let quoteRevision = 0, recoveryRevision = 0, runningRecovery = false;
  const pending = /* @__PURE__ */ new Map();
  const selected = async () => {
    const accounts = await input.provider.request({ method: "eth_accounts" });
    const chain = await input.provider.request({ method: "eth_chainId" });
    if (!Array.isArray(accounts) || !accounts.length || typeof chain !== "string" || !/^0x[0-9a-f]+$/iu.test(chain) || BigInt(chain) !== BigInt(chainId)) throw unavailable();
    return getAddress3(accounts[0]).toLowerCase();
  };
  const stop = (reason) => {
    revision++;
    worker?.terminate();
    worker = null;
    port?.close();
    port = null;
    secretUi = null;
    opened = null;
    session = null;
    sessionBearer = null;
    activeConsentIntentId = null;
    consentAttempted = false;
    activeHandleName = null;
    handleSubmissionAttempted = false;
    activeDepositId = null;
    depositApprovalAttempted = false;
    depositApproved = false;
    depositSubmissionAttempted = false;
    depositReviews.clear();
    paymentContext = null;
    paymentQuotes.clear();
    paymentApprovals.clear();
    approvingPaymentAsset = false;
    activeSendId = null;
    sendApproved = false;
    sendApprovalAttempted = false;
    sendSubmissionAttempted = false;
    sendReviews.clear();
    activeRouteId = null;
    routeApproved = false;
    routeApprovalAttempted = false;
    routeSubmissionAttempted = false;
    routeReviews.clear();
    historyRelayContext = null;
    clearTimeout(expiry);
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(unavailable());
    }
    pending.clear();
    if (reason) input.onLocked?.(reason);
  };
  const authFetch = async (path, body, wallet, routingHeaders = {}) => {
    if (disposed || !PATH.test(path) || typeof body !== "string" || body.length > 1024 * 1024 || await selected() !== wallet) throw unavailable();
    const headers = { Authorization: await authorization() };
    if (!headers.Authorization || headers.Authorization !== sessionBearer) {
      stop("locked");
      throw unavailable();
    }
    const routing = readFamilyRelayRouting(routingHeaders);
    if (path.startsWith("/api/vanta-v8/enhanced/") && !path.endsWith("/session")) {
      const activityRead = /\/(?:monitor|recover|settlement)$/u.test(path);
      assertFamilyRelayContext(routing, (activityRead ? historyRelayContext : null) ?? opened?.context ?? null);
    } else if (routing) throw unavailable();
    const response = await fetch(origin + path, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { ...headers, ...routing ? familyRelayRoutingHeaders(routing) : {}, "Content-Type": "application/json", Accept: "application/json" },
      body
    });
    if (await selected() !== wallet || await authorization() !== sessionBearer) {
      stop("locked");
      throw unavailable();
    }
    if (Number(response.headers.get("content-length") ?? 0) > 1024 * 1024) throw unavailable("RUNTIME_UNAVAILABLE");
    const text = await response.text();
    if (text.length > 1024 * 1024) throw unavailable("RUNTIME_UNAVAILABLE");
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", body: text };
  };
  const send = (message, transfer = []) => {
    if (!worker || disposed) return Promise.reject(unavailable());
    return new Promise((accept, reject) => {
      const id = ++nextId, timer = setTimeout(() => stop("locked"), 10 * 60 * 1e3);
      pending.set(id, { accept, reject, timer });
      try {
        worker.postMessage({ ...message, id }, transfer);
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(unavailable());
      }
    });
  };
  async function start() {
    if (disposed) throw unavailable();
    if (worker) return;
    const started = revision, wallet = await selected();
    sessionBearer = await authorization() ?? null;
    const response = await authFetch("/api/vanta-v8/enhanced/session", "{}", wallet);
    if (response.status !== 200 || !response.contentType.includes("application/json"))
      throw unavailable(response.status === 503 ? "NOT_READY" : "SESSION_EXPIRED");
    const value = JSON.parse(response.body);
    if (value?.success !== true || value.result?.wallet !== wallet || value.result.networkId !== networkId || ![value.result.subjectId, value.result.sessionId].every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(v)) || !Number.isSafeInteger(value.result.expiresAt) || value.result.expiresAt <= Date.now() / 1e3 || started !== revision) throw unavailable();
    session = value.result;
    const current = session;
    worker = new Worker(input.workerUrl || new URL("./app-wallet-worker.mjs", import.meta.url), { type: "module", name: "vanta-family-wallet" });
    const channel = new MessageChannel();
    port = channel.port1;
    worker.addEventListener("message", ({ data }) => {
      if (data?.kind === "progress") return;
      const p = pending.get(data?.id);
      if (!p) return;
      pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.kind === "result") p.accept(data.result);
      else p.reject(Object.assign(
        readDepositFailure(data.depositFailure) ?? unavailable(typeof data.code === "string" ? data.code : "RUNTIME_UNAVAILABLE"),
        { hasBackup: data.hasBackup === true }
      ));
    });
    worker.addEventListener("error", () => stop("locked"));
    worker.addEventListener("messageerror", () => stop("locked"));
    port.onmessage = async ({ data }) => {
      const target = port, active = revision;
      if (!data || !Number.isSafeInteger(data.id) || !target) return;
      try {
        if (session !== current || current.expiresAt <= Date.now() / 1e3) throw unavailable();
        let result;
        const depositContext = opened?.context ?? paymentContext;
        if (data.kind === "password" && secretUi) result = secretUi.password;
        else if (data.kind === "restorePhrase" && secretUi?.phrase) result = secretUi.phrase;
        else if (data.kind === "confirmBackup" && secretUi?.confirm && typeof data.value === "string")
          result = await secretUi.confirm(data.value);
        else if (data.kind === "relayFetch" && typeof data.value?.path === "string")
          result = await authFetch(data.value.path, data.value.body, current.wallet, data.value.headers);
        else if ((data.kind === "handleStatus" || data.kind === "handleSubmit" && activeHandleName && !handleSubmissionAttempted) && opened) {
          const request = data.value, pin = release.lock.contracts.find((c) => c.name === "handle-registry");
          if (request?.chainId !== chainId || data.kind === "handleSubmit" && request.handle !== activeHandleName || request.value !== "0" || !pin || getAddress3(request.to) !== getAddress3(pin.address) || keccak2562(request.data) !== request.transactionDigest) throw unavailable();
          const record = await parseCustomerHandleCalldata(request.data, release);
          if (data.kind === "handleSubmit" && record.route.handle !== activeHandleName || await selected() !== current.wallet || active !== revision) throw unavailable();
          const statusOnly = data.kind === "handleStatus";
          if (!statusOnly) handleSubmissionAttempted = true;
          const response2 = await authFetch("/api/vanta-v8/handles/" + (statusOnly ? "status" : "submit"), JSON.stringify(request), current.wallet);
          let value2;
          try {
            value2 = JSON.parse(response2.body);
          } catch {
            throw Error("Private handle relay: Invalid response from the relay service.");
          }
          if (response2.status !== 200) throw Error(typeof value2?.error === "string" && value2.error.startsWith("Private handle relay: ") ? value2.error : "Private handle relay: The relay service is unavailable. Your saved claim is retained.");
          if (statusOnly && value2.transactionHash === null && value2.state === "not-submitted") result = null;
          else {
            const hash = value2.transactionHash;
            if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(hash)) throw unavailable();
            result = hash;
          }
        } else if (data.kind === "privateSendApprove" && activeSendId && !sendApprovalAttempted && opened) {
          sendApprovalAttempted = true;
          const review = sendReviews.get(activeSendId);
          if (!review || JSON.stringify(data.value) !== JSON.stringify(review) || getAddress3(review.pool) !== getAddress3(opened.context.pool) || review.generationId !== opened.context.generationId || review.deadline <= Date.now() / 1e3 || !review.transactionDigest) throw unavailable();
          sendApproved = true;
          result = true;
        } else if (data.kind === "routedApprove" && activeRouteId && !routeApprovalAttempted && opened) {
          routeApprovalAttempted = true;
          const review = routeReviews.get(activeRouteId);
          const release2 = getCompiledFamilyEvmRelease2();
          const routes = getCompiledVantaFamilyProofResources(release2).funding.routes;
          const gateway = review?.operation === 5 ? familyBridgeRoutes(release2, routes)?.gateway.address : release2.lock.contracts.find((c) => c.name === "private-swap-gateway")?.address ?? routes?.gateway.address;
          if (!review || JSON.stringify(data.value) !== JSON.stringify(review) || getAddress3(review.pool) !== getAddress3(opened.context.pool) || review.generationId !== opened.context.generationId || review.deadline <= Date.now() / 1e3 || !review.transactionDigest || gateway?.toLowerCase() !== review.transactionTarget) throw unavailable();
          routeApproved = true;
          result = true;
        } else if (data.kind === "depositApprove" && activeDepositId && !depositApprovalAttempted && depositContext) {
          depositApprovalAttempted = true;
          const review = depositReviews.get(activeDepositId), actual = data.value;
          if (!matchesFamilyDepositApproval(review, actual, {
            wallet: current.wallet,
            pool: depositContext.pool,
            generationId: depositContext.generationId,
            nowSeconds: Date.now() / 1e3
          }) || paymentRecipient && review?.recipient !== recipientAddress) throw unavailable();
          depositApproved = true;
          result = true;
        } else if (data.kind === "depositSubmit" && activeDepositId && depositApproved && !depositSubmissionAttempted && depositContext) {
          depositSubmissionAttempted = true;
          const review = depositReviews.get(activeDepositId), tx = data.value;
          try {
            if (!review || !tx || Object.keys(tx).sort().join() !== "chainId,data,from,preparedId,to,transactionDigest,value" || tx.preparedId !== activeDepositId || tx.chainId !== chainId || getAddress3(tx.from).toLowerCase() !== current.wallet || getAddress3(tx.to).toLowerCase() !== review.pool.toLowerCase() || tx.transactionDigest !== review.transactionDigest || depositTransactionDigest(tx) !== review.transactionDigest || review.deadline <= Date.now() / 1e3 || await selected() !== current.wallet) throw unavailable();
          } catch {
            if (active === revision) target.postMessage({ id: data.id, ok: false, code: DEPOSIT_SUBMISSION_REJECTED });
            return;
          }
          let transactionHash;
          try {
            transactionHash = await input.provider.request({ method: "eth_sendTransaction", params: [{
              chainId: toBeHex(chainId),
              from: tx.from,
              to: tx.to,
              data: tx.data,
              value: toBeHex(BigInt(tx.value))
            }] });
          } catch (error) {
            const code = depositWalletSubmissionCode(error);
            if (active === revision) target.postMessage({
              id: data.id,
              ok: false,
              code,
              depositFailure: code ? void 0 : publicDepositFailure(depositFailure(uncertainDepositSubmission(error), "Wallet submission"))
            });
            return;
          }
          if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(transactionHash) || active !== revision || await selected() !== current.wallet) throw unavailable();
          result = { transactionHash: transactionHash.toLowerCase() };
        } else if (data.kind === "walletSignConsent" && activeConsentIntentId && !consentAttempted && opened) {
          consentAttempted = true;
          const context = opened.context;
          if (context.networkId !== networkId) throw unavailable();
          result = await signCompiledEnhancedConsent({
            provider: input.provider,
            wallet: current.wallet,
            intentId: activeConsentIntentId,
            context: {
              networkId,
              generationId: context.generationId,
              pool: context.pool,
              assetAddress: context.assetAddress
            },
            request: data.value,
            assertCurrent: async () => {
              if (active !== revision || session !== current || current.expiresAt <= Date.now() / 1e3 || await selected() !== current.wallet || await authorization() !== sessionBearer)
                throw unavailable();
            }
          });
        } else throw unavailable();
        if (active !== revision || session !== current) throw unavailable();
        target.postMessage({ id: data.id, ok: true, value: result });
      } catch (error) {
        if (active === revision) target.postMessage({ id: data.id, ok: false, depositFailure: data.kind === "handleSubmit" || data.kind === "handleStatus" ? publicDepositFailure(depositFailure(error, "Handle submission")) : void 0, code: error?.code === 4001 ? "USER_REJECTED" : void 0 });
      }
    };
    port.start();
    expiry = setTimeout(() => stop("locked"), Math.min(2147483647, current.expiresAt * 1e3 - Date.now()));
    try {
      return await send({ kind: "initialize", config: {
        rpcUrl: input.rpcUrl,
        verificationRpcUrl: input.verificationRpcUrl,
        artifactBaseUrl: input.artifactBaseUrl,
        relayerUrl: origin,
        asset: input.asset ?? "native",
        ...paymentRecipient ? { paymentRecipient } : {},
        partnerAssetConfiguration: input.assetConfiguration,
        session: current
      } }, [channel.port2]);
    } catch (error) {
      stop();
      throw error;
    }
  }
  const command = (name, payload = {}) => {
    const started = revision;
    const quoteCommand = ["quoteDeposit", "quoteWithdrawal", "quotePrivateSend", "quoteRouteFees", "quotePublicBatch"].includes(name), quoteStamp = quoteCommand ? ++quoteRevision : quoteRevision;
    if (/^(quote|prepare|authorize|execute)/u.test(name) || name === "selectAsset") {
      recoveryRevision++; if (runningRecovery) worker?.postMessage({ kind: "pauseDisplayRecovery" });
    }
    const recoveryStamp = recoveryRevision;
    const operation = queue.then(async () => {
      if (quoteCommand && quoteStamp !== quoteRevision) throw Error("Fee preview superseded.");
      if (!worker || !session || started !== revision || session.expiresAt <= Date.now() / 1e3 || await selected() !== session.wallet) throw unavailable();
      if (await authorization() !== sessionBearer) {
        stop("locked");
        throw unavailable();
      }
      const signing = name === "authorize" || name === "authorizeWithdrawal" && payload.enhanced === true;
      if (name === "claimHandle") {
        const handle = payload.handle;
        if (typeof handle !== "string" || activeHandleName !== null) throw unavailable();
        activeHandleName = handle;
        handleSubmissionAttempted = false;
      }
      const depositSigning = name === "executeDeposit";
      const regularWithdrawal = name === "authorizeWithdrawal" && payload.enhanced === false;
      const batchIntent = payload.intentId;
      const normalBatch = name === "authorizePublicBatch" && typeof batchIntent === "string" && batchIntent.startsWith("send_");
      const privateSendSigning = name === "executePrivateSend" || regularWithdrawal || normalBatch;
      const routeSigning = name === "executeRoute";
      if (routeSigning) {
        const id = payload.preparedId;
        if (typeof id !== "string" || activeRouteId !== null || !routeReviews.has(id)) throw unavailable();
        activeRouteId = id;
        routeApproved = false;
        routeApprovalAttempted = false;
        routeSubmissionAttempted = false;
      }
      if (privateSendSigning) {
        const id = regularWithdrawal || normalBatch ? batchIntent : payload.preparedId;
        if (typeof id !== "string" || activeSendId !== null || !sendReviews.has(id)) throw unavailable();
        activeSendId = id;
        sendApproved = false;
        sendApprovalAttempted = false;
        sendSubmissionAttempted = false;
      }
      if (depositSigning) {
        const preparedId = payload.preparedId;
        if (typeof preparedId !== "string" || activeDepositId !== null || !depositReviews.has(preparedId)) throw unavailable();
        activeDepositId = preparedId;
        depositApprovalAttempted = false;
        depositApproved = false;
        depositSubmissionAttempted = false;
      }
      if (signing) {
        const intentId = payload.intentId;
        if (typeof intentId !== "string" || activeConsentIntentId !== null) throw unavailable();
        activeConsentIntentId = intentId;
        consentAttempted = false;
      }
      const historyAsset = payload.historyAsset;
      if (historyAsset !== void 0 && (name === "monitorWithdrawal" || name === "monitorPublicBatch")) {
        const release2 = getCompiledFamilyEvmRelease2();
        const pool = getCompiledVantaFamilyProofResources(release2).funding.pools.find((p) => historyAsset === "native" ? BigInt(p.asset) === 0n : p.asset === historyAsset);
        if (!pool || !opened) throw unavailable();
        historyRelayContext = { networkId: release2.pins.networkId, generationId: release2.pins.generationId, pool: pool.pool };
      }
      try {
        if (name === "recoverNotes") {
          if (recoveryStamp !== recoveryRevision) throw Object.assign(Error("Balance recovery paused for a transaction."), { code: "RECOVERY_SUPERSEDED" });
          runningRecovery = true;
        }
        const result = await send({ kind: "invoke", command: name, payload });
        if (started !== revision) throw unavailable();
        return result;
      } finally {
        if (name === 'recoverNotes') runningRecovery = false;
        historyRelayContext = null;
        if (signing) {
          activeConsentIntentId = null;
          consentAttempted = false;
        }
        if (name === "claimHandle") {
          activeHandleName = null;
          handleSubmissionAttempted = false;
        }
        if (depositSigning) {
          activeDepositId = null;
          depositApprovalAttempted = false;
          depositApproved = false;
          depositSubmissionAttempted = false;
        }
        if (privateSendSigning) {
          activeSendId = null;
          sendApproved = false;
          sendApprovalAttempted = false;
          sendSubmissionAttempted = false;
        }
        if (routeSigning) {
          activeRouteId = null;
          routeApproved = false;
          routeApprovalAttempted = false;
          routeSubmissionAttempted = false;
        }
      }
    });
    queue = operation.catch(() => {
    });
    return operation;
  };
  const initial = await start();
  if (!initial) throw unavailable("RUNTIME_UNAVAILABLE");
  const openWallet = async (name, ui) => {
    if (openingWallet) throw unavailable("STATE_CHANGED");
    openingWallet = true;
    try {
      await start();
      secretUi = ui;
      opened = await command(name);
      return opened;
    } finally {
      secretUi = null;
      openingWallet = false;
    }
  };
  const events = ["accountsChanged", "chainChanged", "disconnect"].map((name) => {
    const listener = () => stop("contextChanged");
    input.provider.on?.(name, listener);
    return { name, listener };
  });
  const pagehide = () => stop("background");
  window.addEventListener("pagehide", pagehide);
  const approveDepositAsset = async ({ quoteId }) => {
    const quote = paymentQuotes.get(quoteId), current = session, started = revision;
    const context = paymentRecipient ? paymentContext : opened?.context;
    if (!context || !current || !quote || approvingPaymentAsset || quote.deadline <= Date.now() / 1e3 || getAddress3(quote.payer) !== getAddress3(current.wallet) || getAddress3(quote.pool) !== getAddress3(context.pool) || getAddress3(quote.asset) !== getAddress3(context.assetAddress) || paymentRecipient && quote.recipient !== recipientAddress) throw unavailable();
    if (BigInt(quote.asset) === 0n) return { transactionHash: null };
    const abi = new Interface(["function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)"]);
    const assertCurrent = async () => {
      if (disposed || session !== current || started !== revision || await selected() !== current.wallet || await authorization() !== sessionBearer) throw unavailable();
    };
    const allowance = async () => {
      await assertCurrent();
      const raw = await input.provider.request({ method: "eth_call", params: [{ to: quote.asset, data: abi.encodeFunctionData("allowance", [current.wallet, quote.pool]) }, "latest"] });
      return BigInt(abi.decodeFunctionResult("allowance", String(raw))[0]);
    };
    const quantity = (value) => typeof value === "string" && /^0x[0-9a-f]+$/iu.test(value);
    const canonicalApproval = async (hash) => {
      const rpc = async (method, params = []) => {
        const response = await fetch(input.rpcUrl, {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(1e4)
        });
        const text = await response.text();
        if (!response.ok || text.length > 1024 * 1024) throw Error("Token approval confirmation RPC is unavailable. No approval was resent.");
        const value = JSON.parse(text);
        if (value?.jsonrpc !== "2.0" || value.id !== 1 || value.error || !Object.hasOwn(value, "result")) throw Error("Token approval confirmation RPC returned an invalid response. No approval was resent.");
        return value.result;
      };
      await assertCurrent();
      const [network, genesis] = await Promise.all([rpc("eth_chainId"), rpc("eth_getBlockByNumber", ["0x0", false])]);
      if (!quantity(network) || BigInt(network) !== BigInt(chainId) || genesis?.hash?.toLowerCase() !== release.pins.genesisHash.toLowerCase()) throw Error("Token approval confirmation RPC belongs to a different network.");
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (!receipt) return null;
      if (!quantity(receipt.blockNumber)) throw Error("Token approval confirmation is missing its mined block number.");
      const [tx, block, head] = await Promise.all([rpc("eth_getTransactionByHash", [hash]), rpc("eth_getBlockByNumber", [receipt.blockNumber, false]), rpc("eth_blockNumber")]);
      await assertCurrent();
      if (!tx || !block) return null;
      if (tx.hash?.toLowerCase() !== hash.toLowerCase() || receipt.transactionHash?.toLowerCase() !== hash.toLowerCase()) throw Error("Token approval confirmation returned a different transaction hash.");
      return { receipt, tx, block, head };
    };
    approvingPaymentAsset = true;
    try {
      if (await allowance() >= BigInt(quote.amountAtomic)) return { transactionHash: null };
      const data = abi.encodeFunctionData("approve", [quote.pool, quote.amountAtomic]);
      let saved = paymentApprovals.get(quoteId);
      if (!saved) {
        saved = {};
        paymentApprovals.set(quoteId, saved);
        await assertCurrent();
        try {
          const hash = await input.provider.request({ method: "eth_sendTransaction", params: [{ chainId: toBeHex(chainId), from: current.wallet, to: quote.asset, data, value: "0x0" }] });
          if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(hash)) throw Error("Token approval outcome is uncertain. Check your wallet activity before continuing.");
          saved.transactionHash = hash;
        } catch (error) {
          if (error?.code === 4001) paymentApprovals.delete(quoteId);
          throw error;
        }
      }
      if (!saved.transactionHash) throw Error("Token approval outcome is uncertain. Check your wallet activity before continuing.");
      while (Date.now() / 1e3 < quote.deadline) {
        await assertCurrent();
        let receipt = await input.provider.request({ method: "eth_getTransactionReceipt", params: [saved.transactionHash] });
        if (receipt) {
          let [tx, block, head] = await Promise.all([input.provider.request({ method: "eth_getTransactionByHash", params: [saved.transactionHash] }), quantity(receipt.blockNumber) ? input.provider.request({ method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] }) : null, input.provider.request({ method: "eth_blockNumber" })]);
          if (!tx || !quantity(tx.value) || !quantity(tx.chainId) || !quantity(receipt.blockNumber) || !quantity(receipt.status) || !quantity(head)) {
            const canonical = await canonicalApproval(saved.transactionHash);
            if (!canonical) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              continue;
            }
            ({ receipt, tx, block, head } = canonical);
          }
          if (!quantity(tx?.value) || !quantity(tx?.chainId) || !quantity(receipt.blockNumber) || !quantity(receipt.status) || !quantity(head)) throw Error("Token approval confirmation is missing required transaction metadata. No approval was resent.");
          if (!tx || getAddress3(tx.from) !== getAddress3(current.wallet) || getAddress3(tx.to) !== getAddress3(quote.asset) || (tx.input ?? tx.data).toLowerCase() !== data.toLowerCase() || BigInt(tx.value) !== 0n || BigInt(tx.chainId) !== BigInt(chainId) || !block || String(block.hash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) throw Error("Token approval transaction differs from the reviewed deposit.");
          if (BigInt(head) - BigInt(receipt.blockNumber) + 1n >= BigInt(SDK_TRANSACTION_CONFIRMATIONS)) {
            if (BigInt(receipt.status) !== 1n || await allowance() < BigInt(quote.amountAtomic)) throw Error("Token approval failed.");
            return { transactionHash: saved.transactionHash };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      throw Error("Deposit review expired while confirming token approval. Review the deposit again.");
    } finally {
      approvingPaymentAsset = false;
    }
  };
  return Object.freeze({
    release: initial.release,
    hasBackup: initial.hasBackup,
    requirePassword: initial.requirePassword,
    canUnlockWithoutPassword: initial.canUnlockWithoutPassword,
    async openPublicPayment() {
      if (!paymentRecipient) throw Error("A public payment recipient is required.");
      if (paymentContext) return paymentContext;
      const context = await command("openPublicPayment");
      if (context.networkId !== networkId || context.generationId !== release.pins.generationId || getAddress3(context.pool) !== getAddress3(paymentRecipient.pool) || getAddress3(context.assetAddress) !== getAddress3(paymentRecipient.asset)) throw unavailable();
      paymentContext = Object.freeze(context);
      return paymentContext;
    },
    approvePaymentAsset: approveDepositAsset,
    approveDepositAsset,
    unlockRememberedWallet: () => openWallet("autoUnlock", { password: "" }).then(() => void 0),
    getPasswordSettings: () => command("passwordSettings"),
    setPasswordRequirement: (requirePassword) => command("setPasswordRequirement", { requirePassword }),
    async createPrivateWallet({ password, confirmRecoveryPhrase }) {
      await openWallet("create", { password, confirm: confirmRecoveryPhrase });
    },
    async restoreWallet({ password, phrase }) {
      await openWallet(phrase === void 0 ? "unlock" : "restore", { password, phrase });
    },
    async publicReceivingIdentity() {
      if (!opened) throw unavailable();
      return { masterPublicKey: BigInt(opened.identity.masterPublicKey), viewingPublicKey: getBytes(opened.identity.viewingPublicKey) };
    },
    getCachedBalance: () => opened?.cachedBalance ?? null,
    recoverNotes: () => command("recoverNotes"),
    async selectAsset(asset) {
      opened = await command("selectAsset", { asset });
      depositReviews.clear();
      sendReviews.clear();
      routeReviews.clear();
    },
    handleAvailable: (handle) => command("handleAvailable", { handle }),
    claimHandle: (handle) => command("claimHandle", { handle: normalizeVantaFamilyHandle(handle) }),
    checkHandle: () => command("checkHandle"),
    currentHandle: (handleHints = []) => command("currentHandle", { handleHints }),
    findHandle: (handle) => command("findHandle", { handle }),
    resolveHandle: (handle) => command("resolveHandle", { handle }),
    receivingAddress: () => command("receivingAddress"),
    quoteRoute: (payload) => command("quoteRoute", payload),
    quotePrivateSend: (payload) => command("quotePrivateSend", payload),
    async prepareReviewedPrivateSend(payload) {
      const review = await command("prepareReviewedPrivateSend", payload);
      sendReviews.set(review.preparedId, review);
      return review;
    },
    quoteRouteFees: (payload) => command("quoteRouteFees", payload),
    async prepareReviewedRoute(payload) {
      const review = await command("prepareReviewedRoute", payload);
      routeReviews.set(review.preparedId, review);
      return review;
    },
    quotePublicBatch: (payload) => command("quotePublicBatch", payload),
    async prepareReviewedPublicBatch(payload) {
      const result = await command("prepareReviewedPublicBatch", payload);
      sendReviews.set(result.review.preparedId, result.review);
      return result;
    },
    authorizePublicBatch: (payload) => command("authorizePublicBatch", payload),
    monitorPublicBatch: (payload) => command("monitorPublicBatch", payload),
    quoteWithdrawal: (payload) => command("quoteWithdrawal", payload),
    async prepareReviewedWithdrawal(payload) {
      const result = await command("prepareReviewedWithdrawal", payload);
      if (result.enhanced === false) sendReviews.set(result.review.preparedId, result.review);
      return result;
    },
    authorizeWithdrawal: (payload) => command("authorizeWithdrawal", payload),
    listWithdrawals: (options = {}) => command("listWithdrawals", { ...options.cached ? { cached: true } : {}, ...activityAsset(options) }),
    monitorWithdrawal: (payload) => command("monitorWithdrawal", payload),
    async preparePrivateSend(payload) {
      const review = await command("preparePrivateSend", payload);
      sendReviews.set(review.preparedId, review);
      return review;
    },
    executePrivateSend: (payload) => command("executePrivateSend", payload),
    reconcilePrivateSend: (payload) => command("reconcilePrivateSend", payload),
    cancelPrivateSend: (payload) => command("cancelPrivateSend", payload),
    async listPrivateSends(options = {}) {
      const rows = await command("listPrivateSends", activityAsset(options));
      for (const row of rows) if (options.historyAsset === void 0 && row.phase === "prepared") sendReviews.set(row.preparedId, row);
      return rows;
    },
    async prepareRoute(payload) {
      const review = await command("prepareRoute", payload);
      routeReviews.set(review.preparedId, review);
      return review;
    },
    executeRoute: (payload) => command("executeRoute", payload),
    reconcileRoute: (payload) => command("reconcileRoute", payload),
    cancelRoute: (payload) => command("cancelRoute", payload),
    async listRoutes(operation, options = {}) {
      const rows = await command("listRoutes", { operation, ...options.cached ? { cached: true } : {}, ...activityAsset(options) });
      for (const row of rows) if (options.historyAsset === void 0 && row.phase === "prepared") routeReviews.set(row.preparedId, row);
      return rows;
    },
    async quoteDeposit(payload) {
      const quote = await command("quoteDeposit", payload);
      if (paymentRecipient && (quote.recipient !== recipientAddress || getAddress3(quote.pool) !== getAddress3(paymentRecipient.pool) || getAddress3(quote.asset) !== getAddress3(paymentRecipient.asset))) throw unavailable();
      if (paymentQuotes.size >= 8) paymentQuotes.delete(paymentQuotes.keys().next().value);
      paymentQuotes.set(quote.quoteId, quote);
      return quote;
    },
    async prepareReviewedDeposit(payload) {
      await approveDepositAsset(payload);
      const review = await command("prepareReviewedDeposit", payload);
      if (paymentRecipient && review.recipient !== recipientAddress) throw unavailable();
      depositReviews.set(review.preparedId, review);
      return review;
    },
    async prepareDeposit(payload) {
      const quote = await command("quoteDeposit", payload);
      paymentQuotes.set(quote.quoteId, quote);
      await approveDepositAsset({ quoteId: quote.quoteId });
      const review = await command("prepareReviewedDeposit", { quoteId: quote.quoteId });
      depositReviews.set(review.preparedId, review);
      return review;
    },
    executeDeposit: (payload) => command("executeDeposit", payload),
    reconcileDeposit: (payload) => command("reconcileDeposit", payload),
    listDepositHistory: (options = {}) => command("listDeposits", { includeCompleted: true, ...activityAsset(options) }),
    async listPendingDeposits() {
      const rows = await command("listDeposits");
      for (const row of rows) if (row.phase === "prepared") depositReviews.set(row.preparedId, row);
      return rows;
    },
    async exportRecoveryBackup() {
      const backup = await command("exportRecoveryBackup");
      return JSON.stringify(backup);
    },
    async importRecoveryBackup(file) {
      const started = revision;
      if (!opened || !(file instanceof Blob) || file.size < 1 || file.size > 32 * 1024 * 1024 + 4096)
        throw Error("Select a valid encrypted private recovery backup.");
      const backup = JSON.parse(await file.text());
      if (started !== revision) throw unavailable();
      return command("importRecoveryBackup", { backup });
    },
    getEnhancedHost() {
      if (!opened) throw unavailable();
      const current = opened, started = revision;
      const bound = (name, payload = {}) => {
        if (opened !== current || revision !== started) return Promise.reject(unavailable());
        return command(name, payload);
      };
      const host = {
        context: current.context,
        getAvailability: () => opened === current && revision === started && session && session.expiresAt > Date.now() / 1e3 ? current.availability : { status: "unqualified", reasonCode: "SESSION_EXPIRED" },
        prepare: (payload) => bound("prepare", payload),
        cancel: (payload) => bound("cancel", payload),
        authorize: (payload) => bound("authorize", payload),
        monitor: (payload) => bound("monitor", payload),
        list: () => bound("list"),
        listSaved: () => bound("list", { cached: true }),
        recover: (payload) => bound("recover", payload)
      };
      return Object.freeze(host);
    },
    lockWallet: () => stop("locked"),
    dispose() {
      disposed = true;
      stop();
      for (const { name, listener } of events) input.provider.removeListener?.(name, listener);
      window.removeEventListener("pagehide", pagehide);
    }
  });
}
export {
  createStealthOSAppWallet
};
