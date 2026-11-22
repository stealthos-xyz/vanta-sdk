import type{FamilyPrivateSendQuote}from'../fresh/family-normal-host.mjs';
import type{FamilyRoutedQuote}from'../fresh/family-routed-host.mjs';
import type{FamilyWithdrawalQuote,FamilyWithdrawalRecord}from'../fresh/family-enhanced-host.mjs';
import {depositWalletSubmissionCode, readDepositFailure, depositFailure, publicDepositFailure} from '../fresh/family-deposit-errors.mjs';
import {matchesFamilyDepositApproval} from '../fresh/family-deposit-approval.mjs';
import {encodeVantaFamilyReceivingAddress,decodeVantaFamilyReceivingAddress} from '../fresh/family-normal-address.mjs';
import {SDK_TRANSACTION_CONFIRMATIONS} from '../fresh/transaction-confirmations.mjs';
/** A local module-worker transport for the real SDK family host. Existing
 * authenticated wallet sessions authorize HTTP; private proofs stay local. */
import {getAddress, getBytes,toBeHex,keccak256,Interface} from "ethers";
import type {FamilyPrivateSendReview,FamilyNoteRecipient} from '../fresh/family-normal-host.mjs';
import type {FamilyRoutedReview} from '../fresh/family-routed-host.mjs';
import {getCompiledFamilyEvmRelease} from '../fresh/family-network.mjs';
import {getCompiledVantaFamilyProofResources} from '../fresh/family-proof-resources.mjs';
import {familyBridgeRoutes} from '../fresh/family-bridge-gateway.mjs';
import {parseCustomerHandleCalldata,normalizeVantaFamilyHandle} from '../fresh/family-customer-handles.mjs';
import {depositTransactionDigest} from "../fresh/family-deposit-host.mjs";
import type {FamilyDepositReview,FamilyDepositTransaction} from "../fresh/family-deposit-host.mjs";
import {signCompiledEnhancedConsent} from "./consent-signer.js";
import type {EnhancedConsentRequest} from "./consent-message.js";

import type {EnhancedWithdrawalHost, EnhancedWithdrawalAvailability} from "./enhanced-types.d.mts";
import type {createVantaFamilyEnhancedHost} from "../fresh/family-enhanced-host.mjs";
import {readFamilyRelayRouting, assertFamilyRelayContext, familyRelayRoutingHeaders} from './routing.mjs';

function activityAsset(options: {historyAsset?: FamilyAsset}) {
  return options.historyAsset === undefined ? {} : {historyAsset:options.historyAsset};
}

export interface SelectedFamilyWalletProvider {
  request(input: {method: string; params?: unknown[]}): Promise<unknown>;
  on?(name: string, listener: () => void): void;
  removeListener?(name: string, listener: () => void): void;
}
export type FamilyCommand = "quotePublicBatch" | "prepareReviewedPublicBatch" | "authorizePublicBatch" | "monitorPublicBatch" | "openPublicPayment" | "create" | "unlock" | "restore" | "autoUnlock" | "passwordSettings" | "setPasswordRequirement" | "selectAsset" | "handleAvailable" | "claimHandle" | "checkHandle" | "currentHandle" | "findHandle" | "resolveHandle" | "recoverNotes" |
  "prepare" | "cancel" | "authorize" | "monitor" | "list" | "recover" | "exportRecoveryBackup" | "importRecoveryBackup" |
  "quoteDeposit" | "prepareReviewedDeposit" | "prepareDeposit" | "executeDeposit" | "reconcileDeposit" | "listDeposits" |
  "receivingAddress" | "preparePrivateSend" | "executePrivateSend" | "reconcilePrivateSend" | "cancelPrivateSend" | "listPrivateSends" |
  "quoteRouteFees" | "prepareReviewedRoute" | "quotePrivateSend" | "prepareReviewedPrivateSend" | "quoteWithdrawal" | "prepareReviewedWithdrawal" | "authorizeWithdrawal" | "listWithdrawals" | "monitorWithdrawal" | "quoteRoute" | "prepareRoute" | "executeRoute" | "reconcileRoute" | "cancelRoute" | "listRoutes";
export type FamilyAsset='native'|'token'|`0x${string}`;
export type FamilyCustomerHandle=Readonly<{handle:string;phase:'prepared'|'submitting'|'submitted'|'confirmed';transactionHash:string|null}>;
type FamilyRuntime = Awaited<ReturnType<typeof createVantaFamilyEnhancedHost>>;
type AuthenticatedSession = {subjectId: string; sessionId: string; expiresAt: number;
  wallet: string; networkId: string};
export type FamilyBootstrap = {rpcUrl: string; verificationRpcUrl: string; artifactBaseUrl: string;
  relayerUrl: string; asset?: FamilyAsset; paymentRecipient?:FamilyNoteRecipient; partnerAssetConfiguration?:{url:string;handleId:string}; session: AuthenticatedSession};
export type FamilyReleaseSummary = {chainId: number; networkLabel: string; generationId: string;
  ceremony: {releaseHash: string}; bootstrap: {finalizedBlockNumber: number|null}; pools: readonly {asset: string; pool: string}[]};
export type FamilyReceivedTransaction = {pool: string; transactionHash: string; blockNumber: number; amountAtomic: string; memo?:string};
export type FamilyNotesSummary = {generationId: string; blockNumber: number; blockHash: string;
  receivedTransactions: readonly FamilyReceivedTransaction[]; pools: readonly {
  asset: string; assetDecimals: number; pool: string; spendableBalanceUnits: string; unreservedBalanceUnits?: string; availableBalanceUnits?: string; projectedBalanceUnits?: string; pendingChangeBalanceUnits?: string; spentBalanceUnits: string;
  spendableCount: number; spentCount: number; verifiedEmpty: boolean;
}[]};
export type FamilyCachedBalance = Readonly<{
  generationId:string; blockNumber:number; blockHash:string;
  pools: readonly Readonly<{pool:string;asset:string;assetDecimals:number;displayBalanceUnits:string}>[];
}>;
type OpenedWallet = {identity: {masterPublicKey: string; viewingPublicKey: string};
  cachedBalance?: FamilyCachedBalance | null;
  context: EnhancedWithdrawalHost["context"]; availability: EnhancedWithdrawalAvailability};
type SecretUi = {password: string; phrase?: string; confirm?: (phrase: string) => Promise<boolean>};
const PATH = /^\/api\/vanta-v8\/(?:enhanced\/(session|quote|prepare|prepare-batch|terms|bind|bind-batch|sign|submit|monitor|recover|settlement)|deposit\/(route|clearance)|handles\/(submit|status)|(?:normal|routed)\/(gas|prequote|quote|submit|status)|routed\/(output-relayer|output-submit|output-status))$/u;
const unavailable = (code = "SESSION_EXPIRED") => Object.assign(Error(code === "NOT_READY"
  ? "The private wallet release is awaiting qualification."
  : code === "RUNTIME_UNAVAILABLE" ? "The private wallet could not be unlocked or its runtime could not be verified."
  : "Unlock the connected wallet to continue."), {code});

export async function createStealthOSAppWallet(input: {
  provider: SelectedFamilyWalletProvider; getSessionToken(): Promise<string>; serviceUrl?:string; workerUrl?:string|URL; rpcUrl: string; verificationRpcUrl: string; artifactBaseUrl: string;
  asset?: FamilyAsset; paymentRecipient?:FamilyNoteRecipient; assetConfiguration?:{url:string;handleId:string};
  onLocked?(reason: "locked" | "background" | "contextChanged"): void;
}) {
  if (!input.provider || typeof input.provider.request !== "function")
    throw Error("Open your already connected wallet before using its private balance.");
  const release=getCompiledFamilyEvmRelease(),chainId=Number(release.pins.networkId.split(':')[1]),networkId=release.pins.networkId;
  const paymentRecipient:FamilyNoteRecipient|undefined=input.paymentRecipient?decodeVantaFamilyReceivingAddress(encodeVantaFamilyReceivingAddress(input.paymentRecipient)) as FamilyNoteRecipient:undefined;
  const recipientAddress=paymentRecipient?encodeVantaFamilyReceivingAddress(paymentRecipient):undefined;
  const service=new URL(input.serviceUrl||window.location.origin);
  if(service.protocol!=='https:'||service.username||service.password||service.search||service.hash||service.pathname!=='/')throw Error('An HTTPS SDK service origin is required.');
  const origin=service.origin;
  const authorization=async()=>{const token=await input.getSessionToken();if(typeof token!=='string'||token.length>8192||!token)throw unavailable();return 'Bearer '+token;};
  if (new URL(origin).protocol !== "https:") throw Error("The private wallet requires HTTPS.");
  let worker: Worker | null = null, port: MessagePort | null = null, session: AuthenticatedSession | null = null;
  let sessionBearer: string | null = null;
  let disposed = false, openingWallet = false, revision = 0, nextId = 0, secretUi: SecretUi | null = null;
  let activeConsentIntentId: string | null = null, consentAttempted = false;
  let activeHandleName:string|null=null,handleSubmissionAttempted=false;
  const depositReviews=new Map<string,FamilyDepositReview>();
  const paymentQuotes=new Map<string,import('../fresh/family-deposit-host.mjs').FamilyDepositQuote>();
  const paymentApprovals=new Map<string,{transactionHash?:string}>();let approvingPaymentAsset=false;
  let paymentContext:EnhancedWithdrawalHost['context']|null=null;
  let activeDepositId:string|null=null,depositApprovalAttempted=false,depositApproved=false,depositSubmissionAttempted=false;
  const sendReviews=new Map<string,FamilyPrivateSendReview>();
  let activeSendId:string|null=null,sendApproved=false,sendApprovalAttempted=false,sendSubmissionAttempted=false;
  const routeReviews=new Map<string,FamilyRoutedReview>();
  let activeRouteId:string|null=null,routeApproved=false,routeApprovalAttempted=false,routeSubmissionAttempted=false;
  let historyRelayContext: {networkId: string; generationId: string; pool: string} | null = null;
  let opened: OpenedWallet | null = null, expiry: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let quoteRevision=0;
  const pending = new Map<number, {accept(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
  const selected = async () => {
    const accounts = await input.provider.request({method: "eth_accounts"});
    const chain = await input.provider.request({method: "eth_chainId"});
    if (!Array.isArray(accounts) || !accounts.length || typeof chain!=='string'||!/^0x[0-9a-f]+$/iu.test(chain)||BigInt(chain) !== BigInt(chainId)) throw unavailable();
    return getAddress(accounts[0]).toLowerCase();
  };
  const stop = (reason?: "locked" | "background" | "contextChanged") => {
    revision++; worker?.terminate(); worker = null; port?.close(); port = null; secretUi = null; opened = null; session = null; sessionBearer = null;
    activeConsentIntentId = null; consentAttempted = false;
    activeHandleName=null;handleSubmissionAttempted=false;
    activeDepositId=null;depositApprovalAttempted=false;depositApproved=false;depositSubmissionAttempted=false;depositReviews.clear();
    paymentContext=null;paymentQuotes.clear();paymentApprovals.clear();approvingPaymentAsset=false;
    activeSendId=null;sendApproved=false;sendApprovalAttempted=false;sendSubmissionAttempted=false;sendReviews.clear();
    activeRouteId=null;routeApproved=false;routeApprovalAttempted=false;routeSubmissionAttempted=false;routeReviews.clear();historyRelayContext=null;
    clearTimeout(expiry);
    for (const p of pending.values()) {clearTimeout(p.timer); p.reject(unavailable());} pending.clear();
    if (reason) input.onLocked?.(reason);
  };
  const authFetch = async (path: string, body: string, wallet: string, routingHeaders: HeadersInit = {}) => {
    if (disposed || !PATH.test(path) || typeof body !== "string" || body.length > 1024 * 1024 ||
        await selected() !== wallet) throw unavailable();
    const headers = {Authorization:await authorization()};
    if (!headers.Authorization || headers.Authorization !== sessionBearer) {stop("locked"); throw unavailable();}
    const routing = readFamilyRelayRouting(routingHeaders);
    if (path.startsWith('/api/vanta-v8/enhanced/') && !path.endsWith('/session')) {
      const activityRead = /\/(?:monitor|recover|settlement)$/u.test(path);
      assertFamilyRelayContext(routing, (activityRead ? historyRelayContext : null) ?? opened?.context ?? null);
    }
    else if (routing) throw unavailable();
    const response = await fetch(origin + path, {method: "POST", credentials: "omit", redirect: "error",
      headers: {...headers, ...(routing ? familyRelayRoutingHeaders(routing) : {}), "Content-Type": "application/json", Accept: "application/json"}, body});
    if (await selected() !== wallet || await authorization() !== sessionBearer) {
      stop("locked"); throw unavailable();
    }
    if (Number(response.headers.get("content-length") ?? 0) > 1024 * 1024) throw unavailable("RUNTIME_UNAVAILABLE");
    const text = await response.text(); if (text.length > 1024 * 1024) throw unavailable("RUNTIME_UNAVAILABLE");
    return {status: response.status, contentType: response.headers.get("content-type") ?? "", body: text};
  };
  const send = (message: object, transfer: Transferable[] = []) => {
    if (!worker || disposed) return Promise.reject(unavailable());
    return new Promise<unknown>((accept, reject) => {
      const id = ++nextId, timer = setTimeout(() => stop("locked"), 10 * 60 * 1000);
      pending.set(id, {accept, reject, timer});
      try {worker!.postMessage({...message, id}, transfer);}
      catch {clearTimeout(timer); pending.delete(id); reject(unavailable());}
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
    if (value?.success !== true || value.result?.wallet !== wallet || value.result.networkId !== networkId ||
        ![value.result.subjectId, value.result.sessionId].every((v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(v)) ||
        !Number.isSafeInteger(value.result.expiresAt) || value.result.expiresAt <= Date.now() / 1000 || started !== revision) throw unavailable();
    session = value.result; const current = session!;
    worker = new Worker(input.workerUrl||new URL("./app-wallet-worker.mjs",import.meta.url), {type: "module", name: "vanta-family-wallet"});
    const channel = new MessageChannel(); port = channel.port1;
    worker.addEventListener("message", ({data}) => {
      if (data?.kind === "progress") return;
      const p = pending.get(data?.id); if (!p) return;
      pending.delete(data.id); clearTimeout(p.timer);
      if (data.kind === "result") p.accept(data.result);
      else p.reject(Object.assign(readDepositFailure(data.depositFailure)??unavailable(typeof data.code === "string" ? data.code : "RUNTIME_UNAVAILABLE"),
        {hasBackup: data.hasBackup === true}));
    });
    worker.addEventListener("error", () => stop("locked"));
    worker.addEventListener("messageerror", () => stop("locked"));
    port.onmessage = async ({data}) => {
      const target = port, active = revision;
      if (!data || !Number.isSafeInteger(data.id) || !target) return;
      try {
        if (session !== current || current.expiresAt <= Date.now() / 1000) throw unavailable();
        let result: unknown;
        const depositContext=opened?.context??paymentContext;
        if (data.kind === "password" && secretUi) result = secretUi.password;
        else if (data.kind === "restorePhrase" && secretUi?.phrase) result = secretUi.phrase;
        else if (data.kind === "confirmBackup" && secretUi?.confirm && typeof data.value === "string")
          result = await secretUi.confirm(data.value);
        else if (data.kind === "relayFetch" && typeof data.value?.path === "string")
          result = await authFetch(data.value.path, data.value.body, current.wallet, data.value.headers);
        else if((data.kind==='handleStatus'||data.kind==='handleSubmit'&&activeHandleName&&!handleSubmissionAttempted)&&opened){
          const request=data.value,pin=release.lock.contracts.find(c=>c.name==='handle-registry');
          if(request?.chainId!==chainId||data.kind==='handleSubmit'&&request.handle!==activeHandleName||request.value!=='0'||!pin||getAddress(request.to)!==getAddress(pin.address)||keccak256(request.data)!==request.transactionDigest)throw unavailable();
          const record=await parseCustomerHandleCalldata(request.data,release);
          if(data.kind==='handleSubmit'&&record.route.handle!==activeHandleName||await selected()!==current.wallet||active!==revision)throw unavailable();
          const statusOnly=data.kind==='handleStatus';if(!statusOnly)handleSubmissionAttempted=true;
          const response=await authFetch('/api/vanta-v8/handles/'+(statusOnly?'status':'submit'),JSON.stringify(request),current.wallet);
          let value;try{value=JSON.parse(response.body);}catch{throw Error('Private handle relay: Invalid response from the relay service.');}
          if(response.status!==200)throw Error(typeof value?.error==='string'&&value.error.startsWith('Private handle relay: ')?value.error:'Private handle relay: The relay service is unavailable. Your saved claim is retained.');
          if(statusOnly&&value.transactionHash===null&&value.state==='not-submitted')result=null;
          else{const hash=value.transactionHash;if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/iu.test(hash))throw unavailable();result=hash;}
        }
        else if(data.kind==='privateSendApprove'&&activeSendId&&!sendApprovalAttempted&&opened){
          sendApprovalAttempted=true;const review=sendReviews.get(activeSendId);
          if(!review||JSON.stringify(data.value)!==JSON.stringify(review)||getAddress(review.pool)!==getAddress(opened.context.pool)||
           review.generationId!==opened.context.generationId||review.deadline<=Date.now()/1000||!review.transactionDigest)throw unavailable();
          sendApproved=true;result=true;
        }
        else if(data.kind==='routedApprove'&&activeRouteId&&!routeApprovalAttempted&&opened){
          routeApprovalAttempted = true;
          const review = routeReviews.get(activeRouteId);
          const release = getCompiledFamilyEvmRelease();
          const routes = getCompiledVantaFamilyProofResources(release).funding.routes;
          const gateway = review?.operation === 5
            ? familyBridgeRoutes(release, routes)?.gateway.address
            : release.lock.contracts.find(c => c.name === 'private-swap-gateway')?.address ?? routes?.gateway.address;
          if(!review||JSON.stringify(data.value)!==JSON.stringify(review)||getAddress(review.pool)!==getAddress(opened.context.pool)||review.generationId!==opened.context.generationId||
           review.deadline<=Date.now()/1000||!review.transactionDigest||gateway?.toLowerCase()!==review.transactionTarget)throw unavailable();
          routeApproved=true;result=true;
        }
        else if(data.kind==="depositApprove"&&activeDepositId&&!depositApprovalAttempted&&depositContext){
          depositApprovalAttempted=true;const review=depositReviews.get(activeDepositId),actual=data.value;
          if(!matchesFamilyDepositApproval(review,actual,{wallet:current.wallet,pool:depositContext.pool,
            generationId:depositContext.generationId,nowSeconds:Date.now()/1000})||paymentRecipient&&review?.recipient!==recipientAddress)throw unavailable();
          depositApproved=true;result=true;
        }
        else if(data.kind==="depositSubmit"&&activeDepositId&&depositApproved&&!depositSubmissionAttempted&&depositContext){
          depositSubmissionAttempted=true;const review=depositReviews.get(activeDepositId),tx=data.value as FamilyDepositTransaction&{preparedId:string;transactionDigest:string};
          if(!review||!tx||Object.keys(tx).sort().join()!=="chainId,data,from,preparedId,to,transactionDigest,value"||
            tx.preparedId!==activeDepositId||tx.chainId!==chainId||getAddress(tx.from).toLowerCase()!==current.wallet||
            getAddress(tx.to).toLowerCase()!==review.pool.toLowerCase()||tx.transactionDigest!==review.transactionDigest||
            depositTransactionDigest(tx)!==review.transactionDigest||review.deadline<=Date.now()/1000||await selected()!==current.wallet)throw unavailable();
          let transactionHash:unknown;
          try {
            transactionHash=await input.provider.request({method:"eth_sendTransaction",params:[{chainId:toBeHex(chainId),
              from:tx.from,to:tx.to,data:tx.data,value:toBeHex(BigInt(tx.value))}]});
          } catch (error) {
            const code=depositWalletSubmissionCode(error);
            if(!code)throw error;
            if(active===revision)target.postMessage({id:data.id,ok:false,code});
            return;
          }
          if(typeof transactionHash!=="string"||!/^0x[0-9a-fA-F]{64}$/u.test(transactionHash)||active!==revision||await selected()!==current.wallet)throw unavailable();
          result={transactionHash:transactionHash.toLowerCase()};
        }
        else if (data.kind === "walletSignConsent" && activeConsentIntentId && !consentAttempted && opened) {
          // This is available ONLY while the user-approved authorize command
          // is in flight; the worker cannot request an arbitrary personal_sign.
          consentAttempted = true;
          const context = opened.context;
          if (context.networkId !== networkId) throw unavailable();
          result = await signCompiledEnhancedConsent({
            provider: input.provider, wallet: current.wallet, intentId: activeConsentIntentId,
            context: {networkId: networkId, generationId: context.generationId,
              pool: context.pool, assetAddress: context.assetAddress},
            request: data.value as EnhancedConsentRequest,
            assertCurrent: async () => {
              if (active !== revision || session !== current ||
                  current.expiresAt <= Date.now() / 1000 ||
                  await selected() !== current.wallet ||
                  await authorization() !== sessionBearer)
                throw unavailable();
            },
          });
        }
        else throw unavailable();
        if (active !== revision || session !== current) throw unavailable();
        target.postMessage({id: data.id, ok: true, value: result});
      } catch(error) {if (active === revision) target.postMessage({id: data.id, ok: false,depositFailure:data.kind==='handleSubmit'||data.kind==='handleStatus'?publicDepositFailure(depositFailure(error,'Handle submission')):undefined,code:(error as {code?:unknown})?.code===4001?'USER_REJECTED':undefined});}
    };
    port.start();
    expiry = setTimeout(() => stop("locked"), Math.min(2147483647, current.expiresAt * 1000 - Date.now()));
    try {return await send({kind: "initialize", config: {rpcUrl: input.rpcUrl, verificationRpcUrl: input.verificationRpcUrl,
      artifactBaseUrl: input.artifactBaseUrl, relayerUrl: origin, asset: input.asset ?? 'native', ...(paymentRecipient?{paymentRecipient}:{}), partnerAssetConfiguration:input.assetConfiguration, session: current} satisfies FamilyBootstrap}, [channel.port2]) as {
        hasBackup: boolean; requirePassword:boolean; canUnlockWithoutPassword:boolean; release: FamilyReleaseSummary;
      };}
    catch (error) {stop(); throw error;}
  }
  const command = <T,>(name: FamilyCommand, payload: object = {}) => {
    const started = revision;
    const quoteCommand=["quoteWithdrawal","quotePrivateSend","quoteRouteFees","quotePublicBatch"].includes(name),quoteStamp=quoteCommand?++quoteRevision:quoteRevision;
    const operation = queue.then(async () => {
      if(quoteCommand&&quoteStamp!==quoteRevision)throw Error("Fee preview superseded.");
      if (!worker || !session || started !== revision || session.expiresAt <= Date.now() / 1000 ||
          await selected() !== session.wallet) throw unavailable();
      if (await authorization() !== sessionBearer) {
        stop("locked"); throw unavailable();
      }
      const signing = name === "authorize" || (name === "authorizeWithdrawal"&&(payload as {enhanced?:boolean}).enhanced===true);
      if(name==='claimHandle'){const handle=(payload as {handle?:unknown}).handle;if(typeof handle!=='string'||activeHandleName!==null)throw unavailable();activeHandleName=handle;handleSubmissionAttempted=false;}
      const depositSigning=name==="executeDeposit";
      const regularWithdrawal=name==='authorizeWithdrawal'&&(payload as {enhanced?:boolean}).enhanced===false;
      const batchIntent=(payload as {intentId?:unknown}).intentId;
      const normalBatch=name==='authorizePublicBatch'&&typeof batchIntent==='string'&&batchIntent.startsWith('send_');
      const privateSendSigning=name==='executePrivateSend'||regularWithdrawal||normalBatch;
      const routeSigning=name==='executeRoute';
      if(routeSigning){const id=(payload as {preparedId?:unknown}).preparedId;
        if(typeof id!=='string'||activeRouteId!==null||!routeReviews.has(id))throw unavailable();
        activeRouteId=id;routeApproved=false;routeApprovalAttempted=false;routeSubmissionAttempted=false;}
      if(privateSendSigning){const id=regularWithdrawal||normalBatch?batchIntent:(payload as {preparedId?:unknown}).preparedId;
        if(typeof id!=='string'||activeSendId!==null||!sendReviews.has(id))throw unavailable();
        activeSendId=id;sendApproved=false;sendApprovalAttempted=false;sendSubmissionAttempted=false;}
      if(depositSigning){const preparedId=(payload as {preparedId?:unknown}).preparedId;
        if(typeof preparedId!=="string"||activeDepositId!==null||!depositReviews.has(preparedId))throw unavailable();
        activeDepositId=preparedId;depositApprovalAttempted=false;depositApproved=false;depositSubmissionAttempted=false;}
      if (signing) {
        const intentId = (payload as {intentId?: unknown}).intentId;
        if (typeof intentId !== "string" || activeConsentIntentId !== null) throw unavailable();
        activeConsentIntentId = intentId; consentAttempted = false;
      }
      const historyAsset = (payload as {historyAsset?: FamilyAsset}).historyAsset;
      if (historyAsset !== undefined && (name === 'monitorWithdrawal' || name === 'monitorPublicBatch')) {
        const release = getCompiledFamilyEvmRelease();
        const pool = getCompiledVantaFamilyProofResources(release).funding.pools.find(p =>
          historyAsset === 'native' ? BigInt(p.asset) === 0n : p.asset === historyAsset);
        if (!pool || !opened) throw unavailable();
        historyRelayContext = {networkId: release.pins.networkId, generationId: release.pins.generationId, pool: pool.pool};
      }
      try {
        const result = await send({kind: "invoke", command: name, payload});
        if (started !== revision) throw unavailable(); return result as T;
      } finally {
        historyRelayContext = null;
        if (signing) { activeConsentIntentId = null; consentAttempted = false; }
        if(name==='claimHandle'){activeHandleName=null;handleSubmissionAttempted=false;}
        if(depositSigning){activeDepositId=null;depositApprovalAttempted=false;depositApproved=false;depositSubmissionAttempted=false;}
        if(privateSendSigning){activeSendId=null;sendApproved=false;sendApprovalAttempted=false;sendSubmissionAttempted=false;}
        if(routeSigning){activeRouteId=null;routeApproved=false;routeApprovalAttempted=false;routeSubmissionAttempted=false;}
      }
    });
    queue = operation.catch(() => {}); return operation;
  };
  const initial = await start();
  if (!initial) throw unavailable("RUNTIME_UNAVAILABLE");
  const openWallet = async (name: "create" | "unlock" | "restore" | "autoUnlock", ui: SecretUi) => {
    if (openingWallet) throw unavailable("STATE_CHANGED");
    openingWallet = true;
    try {await start(); secretUi = ui; opened = await command<OpenedWallet>(name); return opened;}
    finally {secretUi = null; openingWallet = false;}
  };
  const events = ["accountsChanged", "chainChanged", "disconnect"].map(name => {
    const listener = () => stop("contextChanged"); input.provider.on?.(name, listener); return {name, listener};
  });
  const pagehide = () => stop("background");
  window.addEventListener("pagehide", pagehide);
  const approveDepositAsset=async({quoteId}:{quoteId:string})=>{
    const quote=paymentQuotes.get(quoteId),current=session,started=revision;
    const context=paymentRecipient?paymentContext:opened?.context;
    if(!context||!current||!quote||approvingPaymentAsset||quote.deadline<=Date.now()/1000||
      getAddress(quote.payer)!==getAddress(current.wallet)||getAddress(quote.pool)!==getAddress(context.pool)||
      getAddress(quote.asset)!==getAddress(context.assetAddress)||(paymentRecipient&&quote.recipient!==recipientAddress))throw unavailable();
    if(BigInt(quote.asset)===0n)return {transactionHash:null};
    const abi=new Interface(['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
    const assertCurrent=async()=>{if(disposed||session!==current||started!==revision||await selected()!==current.wallet||await authorization()!==sessionBearer)throw unavailable();};
    const allowance=async()=>{await assertCurrent();const raw=await input.provider.request({method:'eth_call',params:[{to:quote.asset,data:abi.encodeFunctionData('allowance',[current.wallet,quote.pool])},'latest']});return BigInt(abi.decodeFunctionResult('allowance',String(raw))[0]);};
    const quantity=(value:unknown):value is string=>typeof value==='string'&&/^0x[0-9a-f]+$/iu.test(value);
    // Some wallet RPC adapters omit optional transaction metadata. Recover the
    // complete record from the configured SDK RPC, then apply the same exact
    // transaction checks. This is the same trust source, not a second provider.
    const canonicalApproval=async(hash:string)=>{
      const rpc=async(method:string,params:unknown[]=[])=>{
        const response=await fetch(input.rpcUrl,{method:'POST',credentials:'omit',redirect:'error',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
        const text=await response.text();if(!response.ok||text.length>1024*1024)throw Error('Token approval confirmation RPC is unavailable. No approval was resent.');
        const value=JSON.parse(text);if(value?.jsonrpc!=='2.0'||value.id!==1||value.error||!Object.hasOwn(value,'result'))throw Error('Token approval confirmation RPC returned an invalid response. No approval was resent.');return value.result;
      };
      await assertCurrent();const [network,genesis]=await Promise.all([rpc('eth_chainId'),rpc('eth_getBlockByNumber',['0x0',false])]);
      if(!quantity(network)||BigInt(network)!==BigInt(chainId)||genesis?.hash?.toLowerCase()!==release.pins.genesisHash.toLowerCase())throw Error('Token approval confirmation RPC belongs to a different network.');
      const receipt=await rpc('eth_getTransactionReceipt',[hash]);if(!receipt)return null;
      if(!quantity(receipt.blockNumber))throw Error('Token approval confirmation is missing its mined block number.');
      const [tx,block,head]=await Promise.all([rpc('eth_getTransactionByHash',[hash]),rpc('eth_getBlockByNumber',[receipt.blockNumber,false]),rpc('eth_blockNumber')]);
      await assertCurrent();if(!tx||!block)return null;
      if(tx.hash?.toLowerCase()!==hash.toLowerCase()||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase())throw Error('Token approval confirmation returned a different transaction hash.');
      return {receipt,tx,block,head};
    };
    approvingPaymentAsset=true;
    try{
      if(await allowance()>=BigInt(quote.amountAtomic))return {transactionHash:null};
      const data=abi.encodeFunctionData('approve',[quote.pool,quote.amountAtomic]);
      let saved=paymentApprovals.get(quoteId);
      if(!saved){saved={};paymentApprovals.set(quoteId,saved);await assertCurrent();
        try{const hash=await input.provider.request({method:'eth_sendTransaction',params:[{chainId:toBeHex(chainId),from:current.wallet,to:quote.asset,data,value:'0x0'}]});
          if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/iu.test(hash))throw Error('Token approval outcome is uncertain. Check your wallet activity before continuing.');saved.transactionHash=hash;
        }catch(error){if((error as {code?:unknown})?.code===4001)paymentApprovals.delete(quoteId);throw error;}
      }
      if(!saved.transactionHash)throw Error('Token approval outcome is uncertain. Check your wallet activity before continuing.');
      while(Date.now()/1000<quote.deadline){
        await assertCurrent();let receipt=await input.provider.request({method:'eth_getTransactionReceipt',params:[saved.transactionHash]}) as any;
        if(receipt){let [tx,block,head]=await Promise.all([input.provider.request({method:'eth_getTransactionByHash',params:[saved.transactionHash]}),quantity(receipt.blockNumber)?input.provider.request({method:'eth_getBlockByNumber',params:[receipt.blockNumber,false]}):null,input.provider.request({method:'eth_blockNumber'})]) as [any,any,any];
          if(!tx||!quantity(tx.value)||!quantity(tx.chainId)||!quantity(receipt.blockNumber)||!quantity(receipt.status)||!quantity(head)){
            const canonical=await canonicalApproval(saved.transactionHash);
            if(!canonical){await new Promise(resolve=>setTimeout(resolve,1500));continue;}
            ({receipt,tx,block,head}=canonical);
          }
          if(!quantity(tx?.value)||!quantity(tx?.chainId)||!quantity(receipt.blockNumber)||!quantity(receipt.status)||!quantity(head))throw Error('Token approval confirmation is missing required transaction metadata. No approval was resent.');
          if(!tx||getAddress(tx.from)!==getAddress(current.wallet)||getAddress(tx.to)!==getAddress(quote.asset)||(tx.input??tx.data).toLowerCase()!==data.toLowerCase()||BigInt(tx.value)!==0n||BigInt(tx.chainId)!==BigInt(chainId)||!block||String(block.hash).toLowerCase()!==String(receipt.blockHash).toLowerCase())throw Error('Token approval transaction differs from the reviewed deposit.');
          if(BigInt(head)-BigInt(receipt.blockNumber)+1n>=BigInt(SDK_TRANSACTION_CONFIRMATIONS)){
            if(BigInt(receipt.status)!==1n||await allowance()<BigInt(quote.amountAtomic))throw Error('Token approval failed.');
            return {transactionHash:saved.transactionHash};
          }
        }
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      throw Error('Deposit review expired while confirming token approval. Review the deposit again.');
    }finally{approvingPaymentAsset=false;}
  };
  return Object.freeze({
    release: initial.release, hasBackup: initial.hasBackup, requirePassword:initial.requirePassword, canUnlockWithoutPassword:initial.canUnlockWithoutPassword,
    async openPublicPayment(){
      if(!paymentRecipient)throw Error('A public payment recipient is required.');
      if(paymentContext)return paymentContext;
      const context=await command<EnhancedWithdrawalHost['context']>('openPublicPayment');
      if(context.networkId!==networkId||context.generationId!==release.pins.generationId||
        getAddress(context.pool)!==getAddress(paymentRecipient.pool)||getAddress(context.assetAddress)!==getAddress(paymentRecipient.asset))throw unavailable();
      paymentContext=Object.freeze(context);return paymentContext;
    },
    approvePaymentAsset:approveDepositAsset,
    approveDepositAsset,
    unlockRememberedWallet:()=>openWallet("autoUnlock",{password:""}).then(()=>undefined),
    getPasswordSettings:()=>command<{requirePassword:boolean;canUnlockWithoutPassword:boolean}>("passwordSettings"),
    setPasswordRequirement:(requirePassword:boolean)=>command<{requirePassword:boolean;canUnlockWithoutPassword:boolean}>("setPasswordRequirement",{requirePassword}),
    async createPrivateWallet({password, confirmRecoveryPhrase}: {password: string; confirmRecoveryPhrase(phrase: string): Promise<boolean>}) {
      await openWallet("create", {password, confirm: confirmRecoveryPhrase});
    },
    async restoreWallet({password, phrase}: {password: string; phrase?: string}) {
      await openWallet(phrase === undefined ? "unlock" : "restore", {password, phrase});
    },
    async publicReceivingIdentity() {
      if (!opened) throw unavailable();
      return {masterPublicKey: BigInt(opened.identity.masterPublicKey), viewingPublicKey: getBytes(opened.identity.viewingPublicKey)};
    },
    getCachedBalance: () => opened?.cachedBalance ?? null,
    recoverNotes: () => command<FamilyNotesSummary>("recoverNotes"),
    async selectAsset(asset:FamilyAsset){opened=await command<OpenedWallet>('selectAsset',{asset});depositReviews.clear();sendReviews.clear();routeReviews.clear();},
    handleAvailable:(handle:string)=>command<{handle:string;available:boolean}>('handleAvailable',{handle}),
    claimHandle:(handle:string)=>command<FamilyCustomerHandle>('claimHandle',{handle:normalizeVantaFamilyHandle(handle)}),
    checkHandle:()=>command<FamilyCustomerHandle|null>('checkHandle'),
    currentHandle:(handleHints:readonly string[]=[])=>command<FamilyCustomerHandle|null>('currentHandle',{handleHints}),
    findHandle:(handle:string)=>command<FamilyCustomerHandle>('findHandle',{handle}),
    resolveHandle:(handle:string)=>command<FamilyNoteRecipient>('resolveHandle',{handle}),
    receivingAddress:()=>command<FamilyNoteRecipient>('receivingAddress'),
    quoteRoute:(payload:{operation:4|5;amountAtomic:string;slippageBps:number;receiver:string})=>command<{amountOutAtomic:string;minimumOutputAtomic:string;maximumDeliveryFeeAtomic:string;outputDecimals:number}>('quoteRoute',payload),
    quotePrivateSend:(payload:{recipient:FamilyNoteRecipient;amountAtomic:string;partnerHandle:string})=>command<FamilyPrivateSendQuote>('quotePrivateSend',payload),
    async prepareReviewedPrivateSend(payload:{quoteId:string;memo?:string}){const review=await command<FamilyPrivateSendReview>('prepareReviewedPrivateSend',payload);sendReviews.set(review.preparedId,review);return review;},
    quoteRouteFees:(payload:{operation:4|5;receiver:string;amountAtomic:string;minimumOutputAtomic:string;maximumDeliveryFeeAtomic:string;partnerHandle:string;slippageBps?:number})=>command<FamilyRoutedQuote>('quoteRouteFees',payload),
    async prepareReviewedRoute(payload:{operation:4|5;quoteId:string}){const review=await command<FamilyRoutedReview>('prepareReviewedRoute',payload);routeReviews.set(review.preparedId,review);return review;},
    quotePublicBatch:(payload:{payments:readonly import('../fresh/family-enhanced-host.mjs').VantaPublicBatchPayment[];partnerHandle:string})=>command<import('../fresh/family-enhanced-host.mjs').FamilyPublicBatchQuote>('quotePublicBatch',payload),
    async prepareReviewedPublicBatch(payload:{quoteId:string}){
      const result=await command<{intentId:string;review:FamilyPrivateSendReview}>('prepareReviewedPublicBatch',payload);
      sendReviews.set(result.review.preparedId,result.review);return result;
    },
    authorizePublicBatch:(payload:{intentId:string})=>command<{transactionId:string;status:import('../fresh/family-enhanced-host.mjs').VantaPublicBatchStatus}>('authorizePublicBatch',payload),
    monitorPublicBatch:(payload:{transactionId:string;historyAsset?:FamilyAsset})=>command<import('../fresh/family-enhanced-host.mjs').VantaPublicBatchStatus>('monitorPublicBatch',payload),
    quoteWithdrawal:(payload:{amountAtomic:string;destination:string;enhanced:boolean;partnerHandle:string})=>command<FamilyWithdrawalQuote>('quoteWithdrawal',payload),
    async prepareReviewedWithdrawal(payload:{quoteId:string}){const result=await command<any>('prepareReviewedWithdrawal',payload);if(result.enhanced===false)sendReviews.set(result.review.preparedId,result.review);return result as {intentId:string;enhanced:boolean};},
    authorizeWithdrawal:(payload:{intentId:string;enhanced:boolean})=>command<any>('authorizeWithdrawal',payload),
    listWithdrawals:(options:{cached?:boolean;historyAsset?:FamilyAsset}={})=>command<readonly FamilyWithdrawalRecord[]>('listWithdrawals',{...(options.cached?{cached:true}:{}),...activityAsset(options)}),
    monitorWithdrawal:(payload:{transactionId:string;enhanced:boolean;historyAsset?:FamilyAsset})=>command<any>('monitorWithdrawal',payload),
    async preparePrivateSend(payload:{recipient:FamilyNoteRecipient;amountAtomic:string;partnerHandle:string;memo?:string}){
      const review=await command<FamilyPrivateSendReview>('preparePrivateSend',payload);sendReviews.set(review.preparedId,review);return review;
    },
    executePrivateSend:(payload:{preparedId:string})=>command<FamilyPrivateSendReview>('executePrivateSend',payload),
    reconcilePrivateSend:(payload:{preparedId:string;historyAsset?:FamilyAsset})=>command<FamilyPrivateSendReview>('reconcilePrivateSend',payload),
    cancelPrivateSend:(payload:{preparedId:string})=>command<FamilyPrivateSendReview>('cancelPrivateSend',payload),
    async listPrivateSends(options:{historyAsset?:FamilyAsset}={}){const rows=await command<readonly FamilyPrivateSendReview[]>('listPrivateSends',activityAsset(options));
      for(const row of rows)if(options.historyAsset===undefined&&row.phase==='prepared')sendReviews.set(row.preparedId,row);return rows;},
    async prepareRoute(payload:{operation:4|5;receiver:string;amountAtomic:string;minimumOutputAtomic:string;maximumDeliveryFeeAtomic:string;partnerHandle:string}){
      const review=await command<FamilyRoutedReview>('prepareRoute',payload);routeReviews.set(review.preparedId,review);return review;},
    executeRoute:(payload:{operation:4|5;preparedId:string})=>command<FamilyRoutedReview>('executeRoute',payload),
    reconcileRoute:(payload:{operation:4|5;preparedId:string;historyAsset?:FamilyAsset})=>command<FamilyRoutedReview>('reconcileRoute',payload),
    cancelRoute:(payload:{operation:4|5;preparedId:string})=>command<FamilyRoutedReview>('cancelRoute',payload),
    async listRoutes(operation:4|5,options:{cached?:boolean;historyAsset?:FamilyAsset}={}){const rows=await command<readonly FamilyRoutedReview[]>('listRoutes',{operation,...(options.cached?{cached:true}:{}),...activityAsset(options)});
      for(const row of rows)if(options.historyAsset===undefined&&row.phase==='prepared')routeReviews.set(row.preparedId,row);return rows;},
    async quoteDeposit(payload:{amountAtomic:string;partnerHandle:string}){
      const quote=await command<import('../fresh/family-deposit-host.mjs').FamilyDepositQuote>('quoteDeposit',payload);
      if(paymentRecipient&&(quote.recipient!==recipientAddress||getAddress(quote.pool)!==getAddress(paymentRecipient.pool)||getAddress(quote.asset)!==getAddress(paymentRecipient.asset)))throw unavailable();
      if(paymentQuotes.size>=8)paymentQuotes.delete(paymentQuotes.keys().next().value!);paymentQuotes.set(quote.quoteId,quote);
      return quote;
    },
    async prepareReviewedDeposit(payload:{quoteId:string}){
      await approveDepositAsset(payload);
      const review=await command<FamilyDepositReview>('prepareReviewedDeposit',payload);if(paymentRecipient&&review.recipient!==recipientAddress)throw unavailable();depositReviews.set(review.preparedId,review);return review;
    },
    async prepareDeposit(payload:{amountAtomic:string;partnerHandle:string}){
      const quote=await command<import('../fresh/family-deposit-host.mjs').FamilyDepositQuote>('quoteDeposit',payload);
      paymentQuotes.set(quote.quoteId,quote);await approveDepositAsset({quoteId:quote.quoteId});
      const review=await command<FamilyDepositReview>('prepareReviewedDeposit',{quoteId:quote.quoteId});depositReviews.set(review.preparedId,review);return review;
    },
    executeDeposit:(payload:{preparedId:string})=>command<{preparedId:string;transactionHash:string;phase:"broadcast-uncertain"}>("executeDeposit",payload),
    reconcileDeposit:(payload:{preparedId:string;transactionHash?:string;historyAsset?:FamilyAsset})=>command<FamilyDepositReview&{transactionHash:string|null}>("reconcileDeposit",payload),
    listDepositHistory:(options:{historyAsset?:FamilyAsset}={})=>command<readonly (FamilyDepositReview&{transactionHash:string|null})[]>("listDeposits",{includeCompleted:true,...activityAsset(options)}),
    async listPendingDeposits(){const rows=await command<readonly FamilyDepositReview[]>("listDeposits");
      for(const row of rows)if(row.phase==="prepared")depositReviews.set(row.preparedId,row);return rows;},
    async exportRecoveryBackup() {
      const backup = await command<Awaited<ReturnType<FamilyRuntime["exportRecoveryBackup"]>>>("exportRecoveryBackup");
      return JSON.stringify(backup);
    },
    async importRecoveryBackup(file: Blob) {
      const started = revision;
      if (!opened || !(file instanceof Blob) || file.size < 1 || file.size > 32 * 1024 * 1024 + 4096)
        throw Error("Select a valid encrypted private recovery backup.");
      const backup: unknown = JSON.parse(await file.text());
      if (started !== revision) throw unavailable();
      return command<Awaited<ReturnType<FamilyRuntime["importRecoveryBackup"]>>>("importRecoveryBackup", {backup});
    },
    getEnhancedHost(): EnhancedWithdrawalHost {
      if (!opened) throw unavailable();
      const current = opened, started = revision;
      const bound = <T,>(name: FamilyCommand, payload: object = {}): Promise<T> => {
        if (opened !== current || revision !== started) return Promise.reject(unavailable());
        return command<T>(name, payload);
      };
      const host: EnhancedWithdrawalHost = {context: current.context,
        getAvailability: () => opened === current && revision === started && session && session.expiresAt > Date.now() / 1000
          ? current.availability : {status: "unqualified", reasonCode: "SESSION_EXPIRED"},
        prepare: payload => bound("prepare", payload), cancel: payload => bound("cancel", payload),
        authorize: payload => bound("authorize", payload),
        monitor: payload => bound("monitor", payload), list: () => bound("list"), listSaved:()=>bound("list",{cached:true}), recover: payload => bound("recover", payload),
      };
      return Object.freeze(host);
    },
    lockWallet: () => stop("locked"),
    dispose() {
      disposed = true; stop();
      for (const {name, listener} of events) input.provider.removeListener?.(name, listener);
      window.removeEventListener("pagehide", pagehide);
    },
  });
}
