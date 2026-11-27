import {quoteFamilyNetRoute} from '../fresh/family-route-review.mjs';
import {createFamilyBalanceCache} from '../fresh/family-balance-cache.mjs';
import {createFamilyPublicArtifactCache,walletWarmupPins,depositWarmupPins,enhancedWarmupPins} from '../fresh/family-public-artifact-cache.mjs';
import {DEPOSIT_INSUFFICIENT_FUNDS,DEPOSIT_SUBMISSION_REJECTED,depositFailure,publicDepositFailure,readDepositFailure} from '../fresh/family-deposit-errors.mjs';
/// <reference lib="webworker" />
/** Trusted local SDK bootstrap. Only reviews, public identity and status leave
 * this worker; the separate UI port handles local unlock and encrypted HTTP. */
import {JsonRpcProvider, Interface, hexlify, getAddress,keccak256,toUtf8Bytes} from "ethers";
import {getCompiledFamilyEvmRelease} from "../fresh/family-network.mjs";
import {getCompiledVantaFamilyProofResources} from '../fresh/family-proof-resources.mjs';
import {createFamilyRpcProviders} from '../fresh/family-rpc.mjs';
import {createFamilyCustomerHandles} from '../fresh/family-customer-handles.mjs';
import {createVantaHostAtomicStore, createVantaHostPrivacyVault, createVantaLocalPrivacyWallet,
  vantaHostStorageScope} from "../fresh/host-storage.mjs";
import {createVantaFamilyEnhancedHost} from "../fresh/family-enhanced-host.mjs";
import {createVantaFamilyDepositHost} from "../fresh/family-deposit-host.mjs";
import {createVantaFamilyPrivateSendHost,createVantaFamilyWithdrawalHost} from "../fresh/family-normal-host.mjs";
import {createVantaFamilyRoutedHost} from "../fresh/family-routed-host.mjs";
import type {FamilyNoteRecipient,FamilyPrivateSendReview} from "../fresh/family-normal-host.mjs";
import type {EnhancedWithdrawalHostSession} from "../fresh/enhanced-host.mjs";
import {createFamilyWalletStoreBackend} from "./encrypted-store.js";
import type {FamilyBootstrap, FamilyCommand, FamilyAsset} from "./app-wallet.js";

import {readFamilyRelayRouting, familyRelayRoutingHeaders} from './routing.mjs';

const compiledRelease=getCompiledFamilyEvmRelease(),chainId=Number(compiledRelease.pins.networkId.split(':')[1]);
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const MAX_AMOUNT = ((1n << 120n) - 1n).toString();
function fail():never {throw Error("Family wallet runtime is unavailable.");}
function normalBatchActivity(row:FamilyPrivateSendReview){
  if(!row.batch)fail();
  return {transactionId:row.preparedId,enhanced:false as const,batch:true as const,
    recipientCount:row.recipientCount,payments:row.payments,amountAtomic:row.amountAtomic,totalDebitAtomic:row.totalDebitAtomic,
    status:{authorized:['included','finalized'].includes(row.phase),authorizationFailed:['failed-finalized','expired-unused'].includes(row.phase),
      finalized:row.phase==='finalized',transactionHash:row.transactionHash}};
}
let port: MessagePort | null = null, serial = 0, epoch = 0, busy = false, started = false;
let provider: JsonRpcProvider, independent: JsonRpcProvider;
let backend: Awaited<ReturnType<typeof createFamilyWalletStoreBackend>> | undefined;
let store: ReturnType<typeof createVantaHostAtomicStore> | undefined;
let balanceCache: ReturnType<typeof createFamilyBalanceCache> | undefined;
let wallet: ReturnType<typeof createVantaLocalPrivacyWallet> | undefined;
let enhanced: Awaited<ReturnType<typeof createVantaFamilyEnhancedHost>> | undefined;
let deposit: Awaited<ReturnType<typeof createVantaFamilyDepositHost>> | undefined;
let depositAction = false, useDeviceUnlock=false;
let customerHandles: Awaited<ReturnType<typeof createFamilyCustomerHandles>> | undefined;
let publicWithdrawal:Awaited<ReturnType<typeof createVantaFamilyWithdrawalHost>>|undefined,publicWithdrawalPending:Promise<Awaited<ReturnType<typeof createVantaFamilyWithdrawalHost>>>|undefined;const withdrawalQuotes=new Map<string,boolean>();
let assetRevision=0;
let privateSend:Awaited<ReturnType<typeof createVantaFamilyPrivateSendHost>>|undefined,privateSendAction=false;
const routedHosts=new Map<4|5,Awaited<ReturnType<typeof createVantaFamilyRoutedHost>>>(),routedPending=new Map<4|5,Promise<Awaited<ReturnType<typeof createVantaFamilyRoutedHost>>>>();let routedAction=false,routeEpoch=0;
const disposeRoutes=()=>{routeEpoch++;for(const host of routedHosts.values())host.dispose();routedHosts.clear();routedPending.clear();};
let config: FamilyBootstrap, session: EnhancedWithdrawalHostSession;
const controller = new AbortController();
const uiPending = new Map<number, {accept(value: unknown): void; reject(error: Error): void}>();
function secret(kind: string, value?: unknown): Promise<unknown> {
  if (!port || controller.signal.aborted) return Promise.reject(Error("Wallet is locked."));
  return new Promise((accept, reject) => {
    const id = ++serial; uiPending.set(id, {accept, reject}); port!.postMessage({id, kind, value});
  });
}
function disposeAssetHosts(){assetRevision++;enhanced?.dispose();enhanced=undefined;deposit?.dispose();deposit=undefined;publicWithdrawal?.dispose();publicWithdrawal=undefined;publicWithdrawalPending=undefined;withdrawalQuotes.clear();privateSend?.dispose();privateSend=undefined;disposeRoutes();}
function dispose() {
  epoch++; controller.abort(); balanceCache=undefined; disposeAssetHosts();wallet?.lock(); store?.close(); backend?.close();
  for (const value of uiPending.values()) value.reject(Error("Wallet is locked.")); uiPending.clear();
  port?.close(); void provider?.destroy(); void independent?.destroy();
}
const live = (revision = epoch) => {
  controller.signal.throwIfAborted();
  if (revision !== epoch || session.expiresAt <= Math.floor(Date.now() / 1000)) fail();
};
async function withdrawalHost(){
  if(publicWithdrawal)return publicWithdrawal;
  if(publicWithdrawalPending)return publicWithdrawalPending;
  const revision=epoch,selectedRevision=assetRevision;
  const task=withdrawalForAsset(config.asset??'native',revision).then(host=>{
      try{live(revision);if(selectedRevision!==assetRevision)fail();}catch(e){host.dispose();throw e;}publicWithdrawal=host;return host;
    }).finally(()=>{if(publicWithdrawalPending===task)publicWithdrawalPending=undefined;});
  publicWithdrawalPending=task;return task;
}
async function routedHost(operation:4|5){
  const cached=routedHosts.get(operation);if(cached)return cached;
  const pending=routedPending.get(operation);if(pending)return pending;
  const revision=epoch,routesRevision=routeEpoch;
  const task=routeForAsset(config.asset??'native',operation,revision,routesRevision)
    .then(host=>{try{live(revision);if(routeEpoch!==routesRevision)fail();}catch(error){host.dispose();throw error;}routedHosts.set(operation,host);return host;})
    .finally(()=>{if(routedPending.get(operation)===task)routedPending.delete(operation);});
  routedPending.set(operation,task);return task;
}
let publicArtifacts:ReturnType<typeof createFamilyPublicArtifactCache>|undefined;
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if(url.origin===new URL(config.relayerUrl).origin&&url.pathname==="/api/v1/relay/vanta-family/private-routes/resolve"){
    if(!depositAction||init?.method&&init.method!=="GET"||[...url.searchParams.keys()].join()!=="handle")fail();
    return fetcher(new URL("/api/vanta-v8/deposit/route",url).href,{method:"POST",body:JSON.stringify({handle:url.searchParams.get("handle")})});
  }
  if (url.origin !== new URL(config.relayerUrl).origin || !/^\/api\/vanta-v8\/(?:enhanced|deposit|normal|routed)\//u.test(url.pathname))
    return publicArtifacts ? publicArtifacts.fetch(input,init) : fetch(input, init);
  if (init?.method !== "POST" || typeof init.body !== "string" || init.body.length > 1024 * 1024 ||
      url.search || url.hash || url.username || url.password) fail();
  live();
  const routing = readFamilyRelayRouting(init?.headers);
  if (url.pathname.startsWith('/api/vanta-v8/enhanced/') && !routing) fail();
  if (url.pathname.startsWith('/api/vanta-v8/normal/') && !privateSendAction) fail();
  if (url.pathname.startsWith('/api/vanta-v8/routed/') && !routedAction) fail();
  const result = await secret("relayFetch", {path: url.pathname, body: init!.body,
    headers: routing ? familyRelayRoutingHeaders(routing) : {}}) as {
    status: number; contentType: string; body: string;
  };
  live();
  if (!result || !Number.isInteger(result.status) || result.status < 100 || result.status > 599 ||
      typeof result.body !== "string" || result.body.length > 1024 * 1024) fail();
  return new Response(result.body, {status: result.status, headers: {"Content-Type": result.contentType}});
};
async function initialize(value: FamilyBootstrap, secretPort: MessagePort) {
  if (started || !(secretPort instanceof MessagePort)) fail(); started = true; config = value; port = secretPort;
  if (!value || value.session.networkId !== compiledRelease.pins.networkId ||
      !/^0x[0-9a-f]{40}$/u.test(value.session.wallet) ||
      ![value.session.subjectId, value.session.sessionId].every(v => /^[A-Za-z0-9_-]{1,128}$/u.test(v)) ||
      !Number.isSafeInteger(value.session.expiresAt)) fail();
  session = Object.freeze({subjectId: value.session.subjectId, sessionId: value.session.sessionId,
    expiresAt: value.session.expiresAt, permissions: ["prepare", "authorize", "monitor", "recover", "cancel"] as const,
    maximumDebitAtomic: MAX_AMOUNT, maximumSessionDebitAtomic: MAX_AMOUNT, allowedDestinations: null});
  live();
  port.onmessage = ({data}) => {
    const pending = uiPending.get(data?.id); if (!pending) return; uiPending.delete(data.id);
    if (data.ok === true) pending.accept(data.value);
    else {
      const code=data.code==='USER_REJECTED'||data.code===DEPOSIT_INSUFFICIENT_FUNDS||data.code===DEPOSIT_SUBMISSION_REJECTED?data.code:undefined;
      pending.reject(readDepositFailure(data.depositFailure)??Object.assign(Error("Trusted wallet action was unavailable."),{code}));
    }
  };
  port.start();
  const https = (raw: string) => {
    const u = new URL(raw); if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) fail(); return u;
  };
  const endpoints = {primary:value.rpcUrl,verification:value.verificationRpcUrl};
  https(value.relayerUrl);
  https(value.artifactBaseUrl);
  const proofInventory=getCompiledVantaFamilyProofResources(compiledRelease);
  publicArtifacts=createFamilyPublicArtifactCache({
    baseUrl:value.artifactBaseUrl,
    pins:(value.paymentRecipient?depositWarmupPins:walletWarmupPins)(proofInventory),
    enhancedPins:value.paymentRecipient?[]:enhancedWarmupPins(proofInventory),
    fetcher:(input,init)=>fetch(input,init),
  });
  let release: ReturnType<typeof getCompiledFamilyEvmRelease>;
  try {release = getCompiledFamilyEvmRelease();}
  catch {throw Object.assign(Error("Compiled family release is not ready."), {code: "NOT_READY"});}
  if (release.pins.networkId !== compiledRelease.pins.networkId) fail();
  ({provider,verificationProvider:independent}=createFamilyRpcProviders(endpoints.primary,endpoints.verification,chainId,release.pins.genesisHash));
  live();
  const identity = {accountId: value.paymentRecipient?'payment-'+keccak256(toUtf8Bytes(session.subjectId)).slice(2):session.subjectId, address: value.session.wallet,
    networkId: release.pins.networkId, generationId: release.pins.generationId};
  backend = await createFamilyWalletStoreBackend({scope: vantaHostStorageScope(identity),paymentJournalOnly:Boolean(value.paymentRecipient)});
  store = createVantaHostAtomicStore({host: backend, scope: identity});
  if(value.paymentRecipient)return {hasBackup:false,requirePassword:false,canUnlockWithoutPassword:false,release:{chainId,networkLabel:release.pins.networkId,generationId:release.pins.generationId,
    ceremony:{releaseHash:release.setup.ceremonyReleaseHash},bootstrap:{finalizedBlockNumber:null},pools:release.lock.contracts.filter(c=>c.kind==='pool').map(c=>({asset:c.name,pool:c.address}))}};
  const vault = createVantaHostPrivacyVault({store});
  wallet = createVantaLocalPrivacyWallet({vault, ui: {
    async authenticate() {
      const revision = epoch;
      if(useDeviceUnlock){const unlocked=await backend!.unlockOnDevice();live(revision);if(!unlocked)throw Object.assign(Error("Wallet password required."),{code:"PASSWORD_REQUIRED"});return true;}
      const password = await secret("password");
      if (typeof password !== "string") return false;
      await backend!.unlock(password); live(revision); return true;
    },
    async confirmBackup(phrase) {return await secret("confirmBackup", phrase) === true;},
    async requestRestorePhrase() {const phrase = await secret("restorePhrase"); if (typeof phrase !== "string") fail(); return phrase as string;},
  }});
  return {hasBackup: await backend.hasRecoveryPhrase(),...await backend.passwordSettings(), release: {chainId: chainId,
    networkLabel: release.pins.networkId, generationId: release.pins.generationId,
    ceremony: {releaseHash: release.setup.ceremonyReleaseHash},
    bootstrap: {finalizedBlockNumber: null},
    pools: release.lock.contracts.filter(c => c.kind === "pool").map(c => ({asset: c.name, pool: c.address}))}};
}
function enhancedForAsset(asset: FamilyAsset) {
  return createVantaFamilyEnhancedHost({walletController: wallet!, store: store!, provider, verificationProvider: independent,
        relayerUrl: config.relayerUrl, artifactBaseUrl: config.artifactBaseUrl, asset, fetcher,
        walletAddress: config.session.wallet,
        getReviewDisplayCache:()=>balanceCache,
        signConsent: async request => {
          const revision = epoch; live();
          const signature = await secret("walletSignConsent", request);
          live(); if (revision !== epoch || typeof signature !== "string") fail();
          return signature as string;
        },
        getSession: () => {live(); return session;}, signal: controller.signal,
        onProgress: () => scope.postMessage({kind: "progress"})});
}
function depositForAsset(asset: FamilyAsset) {
  return createVantaFamilyDepositHost({walletController:wallet!,store:store!,provider,verificationProvider:independent,
        relayerUrl:config.relayerUrl,artifactBaseUrl:config.artifactBaseUrl,asset,walletAddress:config.session.wallet,fetcher,signal:controller.signal,partnerAssetConfiguration:config.partnerAssetConfiguration,
        getSession:()=>{live();return {...session,permissions:depositAction?[...session.permissions,"deposit"]:session.permissions};},
        approveDeposit:async review=>{live();if(!depositAction)fail();const revision=epoch;
          const result=await secret("depositApprove",review);live(revision);return result===true;},
        submitTransaction:async request=>{live();if(!depositAction)fail();const revision=epoch;
          const result=await secret("depositSubmit",request) as {transactionHash:string};live(revision);return result;},
        onProgress:()=>scope.postMessage({kind:"progress"})});
}
function withdrawalForAsset(asset: FamilyAsset, revision = epoch) {
  return createVantaFamilyWithdrawalHost({walletController:wallet!,store:store!,provider,verificationProvider:independent,relayerUrl:config.relayerUrl,artifactBaseUrl:config.artifactBaseUrl,asset,walletAddress:config.session.wallet,fetcher,signal:controller.signal,partnerAssetConfiguration:config.partnerAssetConfiguration,
    getReviewDisplayCache:()=>balanceCache,
    approvePrivateSend:async review=>{live(revision);if(!privateSendAction)fail();return await secret('privateSendApprove',review)===true;}});
}
function routeForAsset(asset: FamilyAsset, operation: 4 | 5, revision = epoch, routesRevision = routeEpoch) {
  return createVantaFamilyRoutedHost({operation,walletController:wallet!,store:store!,provider,verificationProvider:independent,
    relayerUrl:config.relayerUrl,artifactBaseUrl:config.artifactBaseUrl,asset,walletAddress:config.session.wallet,fetcher,signal:controller.signal,partnerAssetConfiguration:config.partnerAssetConfiguration,
    getReviewDisplayCache:()=>balanceCache,
    approveRoute:async review=>{live(revision);if(!routedAction||routeEpoch!==routesRevision)fail();const approved=await secret('routedApprove',review);live(revision);return approved===true;}});
}
function privateSendForAsset(asset: FamilyAsset) {
  return createVantaFamilyPrivateSendHost({walletController:wallet!,store:store!,provider,verificationProvider:independent,
       relayerUrl:config.relayerUrl,artifactBaseUrl:config.artifactBaseUrl,asset,walletAddress:config.session.wallet,fetcher,signal:controller.signal,partnerAssetConfiguration:config.partnerAssetConfiguration,
       getReviewDisplayCache:()=>balanceCache,
       approvePrivateSend:async review=>{live();if(!privateSendAction)fail();const revision=epoch;
        const approved=await secret('privateSendApprove',review);live(revision);return approved===true;}});
}

const historyCommands = new Set<FamilyCommand>([
  'listDeposits', 'listPrivateSends', 'listRoutes', 'listWithdrawals',
  'reconcileDeposit', 'reconcilePrivateSend', 'reconcileRoute', 'monitorWithdrawal', 'monitorPublicBatch',
]);
function activityHosts(asset: FamilyAsset) {
  const hosts: {dispose():void}[] = [];
  const keep = async <T extends {dispose():void}>(opening: Promise<T>) => {
    const host = await opening;
    hosts.push(host);
    return host;
  };
  return {
    enhanced: () => keep(enhancedForAsset(asset)),
    deposit: () => keep(depositForAsset(asset)),
    withdrawal: () => keep(withdrawalForAsset(asset)),
    privateSend: () => keep(privateSendForAsset(asset)),
    route: (operation:4|5) => keep(routeForAsset(asset, operation)),
    dispose: () => { for (const host of hosts) host.dispose(); },
  };
}
async function invokeScoped(command: FamilyCommand, payload: Record<string, unknown>) {
  if (!Object.hasOwn(payload, 'historyAsset')) return invoke(command, payload);
  live();
  const {historyAsset, ...args} = payload;
  if (!store || !enhanced || config.paymentRecipient || !historyCommands.has(command) || typeof historyAsset !== 'string') fail();
  const pool = getCompiledVantaFamilyProofResources(compiledRelease).funding.pools.find(p =>
    historyAsset === 'native' ? BigInt(p.asset) === 0n : p.asset === historyAsset);
  if (!pool) fail();
  // Empty journals can be listed without opening otherwise unused proof runtimes.
  let namespaces: string[] = [];
  if (command === 'listDeposits' && args.includeCompleted === true && Object.keys(args).length === 1)
    namespaces = ['family-kzg-deposits-v1/'+pool.pool];
  if (command === 'listPrivateSends' && Object.keys(args).length === 0)
    namespaces = ['family-private-sends-v1/'+pool.pool];
  if (command === 'listRoutes' && args.operation === 5 && (args.cached === true || args.cached === undefined) &&
      Object.keys(args).every(key=>key==='operation'||key==='cached') &&
      getCompiledVantaFamilyProofResources(compiledRelease).funding.routes?.bnmPool === pool.pool)
    namespaces = ['family-routed-v1/5/'+pool.pool];
  if (command === 'listWithdrawals' && args.cached === true && Object.keys(args).length === 1)
    namespaces = ['family-public-withdrawals-v1/'+pool.pool, 'enhanced-funding-preparations-v1/'+pool.pool,
      'enhanced-withdrawals-v1/'+pool.pool+'/'+pool.asset];
  if (namespaces.length) {
    const journalRows = await Promise.all(namespaces.map(namespace=>store!.read(namespace)));
    if (journalRows.every(rows=>Array.isArray(rows)&&rows.length===0)) return [];
  }
  if (pool.pool === enhanced.host.context.pool) return invoke(command, args);
  const history = activityHosts(historyAsset as FamilyAsset);
  try {
    return await invoke(command, args, history);
  } finally { history.dispose(); }
}
async function invoke(command: FamilyCommand, payload: Record<string, unknown>, history?: ReturnType<typeof activityHosts>) {
  live(); if ((!wallet&&!config.paymentRecipient)||!store) fail();
  const depositCommands=['quoteDeposit','prepareReviewedDeposit','executeDeposit','reconcileDeposit','listDeposits'];
  if(config.paymentRecipient&&!['openPublicPayment',...depositCommands].includes(command))fail();
  if(command==='openPublicPayment'){
    if(!config.paymentRecipient||Object.keys(payload).length||deposit)fail();
    await backend!.openPaymentJournal();
    deposit=await createVantaFamilyDepositHost({paymentRecipient:config.paymentRecipient,store:store!,provider,verificationProvider:independent,
      relayerUrl:config.relayerUrl,artifactBaseUrl:config.artifactBaseUrl,asset:config.asset??'native',walletAddress:config.session.wallet,fetcher,signal:controller.signal,partnerAssetConfiguration:config.partnerAssetConfiguration,
      getSession:()=>{live();return {...session,permissions:depositAction?['deposit']:[]};},
      approveDeposit:async review=>{live();if(!depositAction)fail();const revision=epoch;const approved=await secret('depositApprove',review);live(revision);return approved===true;},
      submitTransaction:async request=>{live();if(!depositAction)fail();const revision=epoch;const sent=await secret('depositSubmit',request) as {transactionHash:string};live(revision);return sent;},
    });
    const resource=getCompiledVantaFamilyProofResources(compiledRelease).funding.pools.find(p=>p.pool.toLowerCase()===config.paymentRecipient!.pool.toLowerCase());
    if(!resource)fail();
    setTimeout(()=>{void publicArtifacts?.warm().catch(()=>{});void deposit?.warmProofRuntime().catch(()=>{});void deposit?.warmWalletClearance().catch(()=>{});},0);
    return {networkId:compiledRelease.pins.networkId,generationId:compiledRelease.pins.generationId,pool:resource.pool,assetAddress:resource.asset,assetSymbol:resource.assetSymbol,assetDecimals:resource.assetDecimals};
  }
  if(command==="passwordSettings"){if(Object.keys(payload).length)fail();return backend!.passwordSettings();}
  if(command==="setPasswordRequirement"){if(!enhanced||Object.keys(payload).join()!=="requirePassword"||typeof payload.requirePassword!=="boolean")fail();await backend!.setRequirePassword(payload.requirePassword);return backend!.passwordSettings();}
  if (command === "selectAsset") {
    if(Object.keys(payload).join()!=='asset'||typeof payload.asset!=='string'||!getCompiledFamilyEvmRelease().lock.contracts.some(c=>c.kind==='pool'&&c.address.toLowerCase()===(getCompiledVantaFamilyProofResources(getCompiledFamilyEvmRelease()).funding.pools.find(p=>payload.asset==='native'?BigInt(p.asset)===0n:p.asset.toLowerCase()===payload.asset)?.pool)))fail();
    wallet.requireWallet();
  }
  if (command === "create" || command === "unlock" || command === "restore" || command === "autoUnlock" || command==='selectAsset') {
    if (command!=='selectAsset'&&Object.keys(payload).length) fail();
    const switching=command==='selectAsset',nextAsset=switching?payload.asset as FamilyBootstrap['asset']:config.asset??'native';
    let nextEnhanced:typeof enhanced,nextDeposit:typeof deposit;
    if(!switching)disposeAssetHosts();
    try {
      if(command!=='selectAsset'){useDeviceUnlock=command==='autoUnlock';try{await wallet![command==='autoUnlock'?'unlock':command]();}finally{useDeviceUnlock=false;}} live();
      nextEnhanced = await enhancedForAsset(nextAsset);
      nextDeposit = await depositForAsset(nextAsset);
      const identity = await wallet!.requireWallet().publicReceivingIdentity(); live();
      let cachedBalance = null;
      if (!switching) {
        const resources = getCompiledVantaFamilyProofResources(compiledRelease);
        const privateIdentity = keccak256(toUtf8Bytes(JSON.stringify([
          'STEALTHOS_FAMILY_BALANCE_DISPLAY_V1', identity.masterPublicKey.toString(), hexlify(identity.viewingPublicKey),
        ])));
        balanceCache = createFamilyBalanceCache({store, identity:privateIdentity,
          generationId:compiledRelease.pins.generationId, pools:resources.funding.pools,liveHistory:true});
        if (command !== 'create') cachedBalance = await balanceCache.readSnapshot().catch(()=>null);
        await backend!.rememberIfAllowed().catch(()=>false);
      }
      live();
      // Commit only after both selected-asset hosts opened. A failed public
      // resource read preserves the unlocked previous asset and its journals.
      if(switching)disposeAssetHosts();
      enhanced=nextEnhanced;deposit=nextDeposit;config={...config,asset:nextAsset};
      const selectedRevision=assetRevision;
      // Start native wallet screening at setup. A valid clearance is reused
      // by deposits; a pending assessment never prevents wallet creation.
      void deposit.warmWalletClearance().catch(()=>{});
      // Public downloads run after setup, without delaying wallet home.
      setTimeout(()=>{if(selectedRevision!==assetRevision)return;void publicArtifacts?.warm().catch(()=>{});void deposit?.warmProofRuntime().catch(()=>{});void withdrawalHost().then(host=>host.warmProofRuntime()).catch(()=>{});},0);
      return {identity: {masterPublicKey: identity.masterPublicKey.toString(), viewingPublicKey: hexlify(identity.viewingPublicKey)},
        context: enhanced.host.context, availability: enhanced.host.getAvailability(), cachedBalance};
    } catch (error) {
      nextEnhanced?.dispose();nextDeposit?.dispose();
      if(!switching){balanceCache=undefined;disposeAssetHosts();wallet!.lock();backend!.lock();}
      throw error;
    }
  }
  if (!enhanced&&!(config.paymentRecipient&&deposit&&depositCommands.includes(command))) fail();
  if(command==='quoteRoute'){
    const {operation,amountAtomic,slippageBps,receiver}=payload;
    if(Object.keys(payload).sort().join()!=='amountAtomic,operation,receiver,slippageBps'||![4,5].includes(Number(operation))||typeof amountAtomic!=='string'||!/^\d+$/u.test(amountAtomic)||BigInt(amountAtomic)<=0n||BigInt(amountAtomic)>=(1n<<120n)||!Number.isInteger(slippageBps)||Number(slippageBps)<1||Number(slippageBps)>5000||typeof receiver!=='string')fail();
    // Warm the active routed operation while its public venue quote is read.
    // The host and row keys are coalesced with the subsequent fee review.
    void routedHost(operation as 4|5).then(host=>host.warmProofRuntime()).catch(()=>{});
    return quoteFamilyNetRoute({provider,verificationProvider:independent,asset:config.asset??'native',operation,amountAtomic,slippageBps,receiver});
  }
  if(['handleAvailable','claimHandle','checkHandle','currentHandle','findHandle','resolveHandle'].includes(command)){
    const needsName=['handleAvailable','claimHandle','findHandle','resolveHandle'].includes(command);
    if(command==='currentHandle'){if(Object.keys(payload).join()!=='handleHints'||!Array.isArray(payload.handleHints)||payload.handleHints.length>16||payload.handleHints.some(h=>typeof h!=='string'))fail();}
    else if(needsName?(Object.keys(payload).join()!=='handle'||typeof payload.handle!=='string'):Object.keys(payload).length)fail();
    customerHandles??=await createFamilyCustomerHandles({walletController:wallet,store,provider,verificationProvider:independent,artifactBaseUrl:config.artifactBaseUrl,fetcher,signal:controller.signal,submitTransaction:async request=>{const revision=epoch;const hash=await secret('handleSubmit',request);live(revision);if(typeof hash!=='string')fail();return hash;},reconcileTransaction:async request=>{const revision=epoch;const hash=await secret('handleStatus',request);live(revision);if(hash!==null&&typeof hash!=='string')fail();return hash as string|null;}});
    if(command==='handleAvailable')return customerHandles.available(payload.handle as string);
    if(command==='claimHandle')return customerHandles.claim(payload.handle as string);
    if(command==='checkHandle')return customerHandles.check();
    if(command==='currentHandle')return customerHandles.current(payload.handleHints as string[]);
    if(command==='findHandle')return customerHandles.find(payload.handle as string);
    return customerHandles.resolve(payload.handle as string,config.asset??'native');
  }
  if(['quoteRouteFees','prepareReviewedRoute','prepareRoute','executeRoute','reconcileRoute','cancelRoute','listRoutes'].includes(command)){
    const operation=payload.operation;if(operation!==4&&operation!==5)fail();routedAction=true;
    try{
      const op=operation as 4|5,host=await (history ? history.route(op) : routedHost(op));
      if(command==='listRoutes'){if(!['operation','cached,operation'].includes(Object.keys(payload).sort().join())||payload.cached!==undefined&&typeof payload.cached!=='boolean')fail();return await host.list({cached:payload.cached===true});}
      if(command==='prepareReviewedRoute'){if(Object.keys(payload).sort().join()!=='operation,quoteId'||typeof payload.quoteId!=='string')fail();return await host.prepareReviewed({quoteId:payload.quoteId});}
      if(command==='prepareRoute'||command==='quoteRouteFees'){
       if(Object.keys(payload).filter(k=>k!=='slippageBps').sort().join()!=='amountAtomic,maximumDeliveryFeeAtomic,minimumOutputAtomic,operation,partnerHandle,receiver'||
        payload.slippageBps!==undefined&&(!Number.isInteger(payload.slippageBps)||Number(payload.slippageBps)<1||Number(payload.slippageBps)>5000)||
        ['amountAtomic','maximumDeliveryFeeAtomic','minimumOutputAtomic','partnerHandle','receiver'].some(k=>typeof payload[k]!=='string'))fail();
       return await host[command==='quoteRouteFees'?'quote':'prepare'](payload as {amountAtomic:string;maximumDeliveryFeeAtomic:string;minimumOutputAtomic:string;partnerHandle:string;receiver:string;slippageBps?:number});}
      if(Object.keys(payload).sort().join()!=='operation,preparedId'||typeof payload.preparedId!=='string')fail();
      if(command==='executeRoute')return await host.execute({preparedId:payload.preparedId});
      if(command==='cancelRoute')return await host.cancel({preparedId:payload.preparedId});
      const result=await host.reconcile({preparedId:payload.preparedId});
      return op===5&&result.phase==='finalized'?await host.monitorDelivery({preparedId:payload.preparedId}):result;
    }finally{routedAction=false;}
  }
  if(['receivingAddress','quotePrivateSend','prepareReviewedPrivateSend','preparePrivateSend','executePrivateSend','reconcilePrivateSend','cancelPrivateSend','listPrivateSends'].includes(command)){
    privateSendAction=true;
    try{
      const sendHost = history ? await history.privateSend() : (privateSend ??= await privateSendForAsset(config.asset??'native'));
      if(command==='receivingAddress'||command==='listPrivateSends'){if(Object.keys(payload).length)fail();
       return command==='receivingAddress'?await sendHost.receivingAddress():await sendHost.list();}
      if(command==='prepareReviewedPrivateSend'){
        if(!['memo,quoteId','quoteId'].includes(Object.keys(payload).sort().join())||typeof payload.quoteId!=='string' ||
           payload.memo!==undefined&&typeof payload.memo!=='string')fail();
        return await sendHost.prepareReviewed({quoteId:payload.quoteId,memo:payload.memo as string|undefined});
      }
      if(command==='preparePrivateSend'||command==='quotePrivateSend'){
       const fields=Object.keys(payload).sort().join();
       if((fields!=='amountAtomic,partnerHandle,recipient'&&
           !(command==='preparePrivateSend'&&fields==='amountAtomic,memo,partnerHandle,recipient'&&typeof payload.memo==='string'))||
        typeof payload.amountAtomic!=='string'||typeof payload.partnerHandle!=='string'||
        !payload.recipient||typeof payload.recipient!=='object'||Array.isArray(payload.recipient))fail();
       return await sendHost[command==='quotePrivateSend'?'quote':'prepare'](payload as {amountAtomic:string;partnerHandle:string;recipient:FamilyNoteRecipient;memo?:string});}
      if(Object.keys(payload).join()!=='preparedId'||typeof payload.preparedId!=='string')fail();
      if(command==='executePrivateSend')return await sendHost.execute({preparedId:payload.preparedId});
      if(command==='cancelPrivateSend')return await sendHost.cancel({preparedId:payload.preparedId});
      return await sendHost.reconcile({preparedId:payload.preparedId});
    }finally{privateSendAction=false;}
  }
  if(command==="quoteDeposit"||command==="prepareReviewedDeposit"||command==="prepareDeposit"||command==="executeDeposit"||command==="reconcileDeposit"||command==="listDeposits"){
    depositAction=true;
    try{
      const depositHost = history ? await history.deposit() : deposit;
      if(!depositHost)fail();
      if(command==="listDeposits"){if(Object.keys(payload).length===0)return await depositHost.listPendingDeposits();if(Object.keys(payload).join()!=="includeCompleted"||payload.includeCompleted!==true)fail();return await depositHost.listDepositHistory();}
      if(command==="prepareReviewedDeposit"){
        if(Object.keys(payload).join()!=="quoteId"||typeof payload.quoteId!=="string")fail();
        return await depositHost.prepareReviewedDeposit({quoteId:payload.quoteId});
      }
      if(command==="quoteDeposit"||command==="prepareDeposit"){
        if(Object.keys(payload).sort().join()!=="amountAtomic,partnerHandle"||typeof payload.amountAtomic!=="string"||typeof payload.partnerHandle!=="string")fail();
        return await depositHost[command](payload as {amountAtomic:string;partnerHandle:string});
      }
      if(command==='reconcileDeposit'&&config.paymentRecipient){
        if(Object.keys(payload).filter(k=>k!=='transactionHash').join()!=='preparedId'||typeof payload.preparedId!=='string'||payload.transactionHash!==undefined&&(typeof payload.transactionHash!=='string'||!/^0x[0-9a-f]{64}$/iu.test(payload.transactionHash)))fail();
        return await depositHost.reconcileDeposit(payload as {preparedId:string;transactionHash?:string});
      }
      if(Object.keys(payload).join()!=="preparedId"||typeof payload.preparedId!=="string")fail();
      return await depositHost[command]({preparedId:payload.preparedId as string});
    }finally{depositAction=false;}
  }
  if (command === "recoverNotes") {
    if (Object.keys(payload).length) fail();
    const cache = balanceCache;
    const summary = await enhanced!.recoverNotes({displayCache:cache});
    live();
    await cache?.saveSnapshot(summary).catch(()=>{});
    return summary;
  }
  if (command === "exportRecoveryBackup") {if (Object.keys(payload).length) fail(); return enhanced!.exportRecoveryBackup();}
  if (command === "importRecoveryBackup") {
    if (Object.keys(payload).join() !== "backup" || !payload.backup || typeof payload.backup !== "object" ||
        Array.isArray(payload.backup) || JSON.stringify(payload.backup).length > 32 * 1024 * 1024 + 4096) fail();
    return enhanced!.importRecoveryBackup(payload.backup as Parameters<NonNullable<typeof enhanced>["importRecoveryBackup"]>[0]);
  }
  if(['quotePublicBatch','prepareReviewedPublicBatch','authorizePublicBatch','monitorPublicBatch'].includes(command)){
    privateSendAction=true;
    try{
      if(command==='quotePublicBatch'){
        if(Object.keys(payload).sort().join()!=='partnerHandle,payments'||typeof payload.partnerHandle!=='string'||!Array.isArray(payload.payments))fail();
        return await (await withdrawalHost()).quoteBatch({payments:payload.payments,partnerHandle:payload.partnerHandle});
      }
      if(command==='prepareReviewedPublicBatch'){
        if(Object.keys(payload).join()!=='quoteId'||typeof payload.quoteId!=='string')fail();
        const review=await (await withdrawalHost()).prepareReviewed({quoteId:payload.quoteId,batch:true});
        if(!review.batch)fail();
        return {intentId:review.preparedId,review};
      }
      if(command==='authorizePublicBatch'){
        if(Object.keys(payload).join()!=='intentId'||typeof payload.intentId!=='string')fail();
        return normalBatchActivity(await (await withdrawalHost()).execute({preparedId:payload.intentId,batch:true}));
      }
      if(Object.keys(payload).join()!=='transactionId'||typeof payload.transactionId!=='string')fail();
      if(payload.transactionId.startsWith('send_')){
        return normalBatchActivity(await (await (history ? history.withdrawal() : withdrawalHost())).reconcile({preparedId:payload.transactionId,batch:true})).status;
      }
      return await (history ? await history.enhanced() : enhanced!).publicBatch.monitor({transactionId:payload.transactionId});
    }finally{privateSendAction=false;}
  }
  if(['quoteWithdrawal','prepareReviewedWithdrawal','authorizeWithdrawal','listWithdrawals','monitorWithdrawal'].includes(command)){
    privateSendAction=true;
    try{
      const normalWithdrawal=()=>history ? history.withdrawal() : withdrawalHost();
      if(command==='quoteWithdrawal'){
        if(Object.keys(payload).sort().join()!=='amountAtomic,destination,enhanced,partnerHandle'||typeof payload.enhanced!=='boolean'||typeof payload.destination!=='string'||typeof payload.amountAtomic!=='string'||typeof payload.partnerHandle!=='string')fail();
        const q=payload.enhanced?await enhanced!.quoteWithdrawal(payload as any):await (await normalWithdrawal()).quote({recipient:payload.destination,amountAtomic:payload.amountAtomic,partnerHandle:payload.partnerHandle});
        if(withdrawalQuotes.size>=4)withdrawalQuotes.delete(withdrawalQuotes.keys().next().value);withdrawalQuotes.set(q.quoteId,payload.enhanced);
        if(payload.enhanced)return q;
        if(!('amountAtomic' in q)||!('deadline' in q))fail();
        return {...q,netPayoutAtomic:q.amountAtomic,asset:enhanced!.host.context.assetSymbol,destination:payload.destination,enhanced:false,windowSeconds:0,expiresAt:q.deadline};
      }
      if(command==='prepareReviewedWithdrawal'){
        if(Object.keys(payload).join()!=='quoteId'||typeof payload.quoteId!=='string'||!withdrawalQuotes.has(payload.quoteId))fail();const isEnhanced=withdrawalQuotes.get(payload.quoteId);withdrawalQuotes.delete(payload.quoteId);
        if(isEnhanced)return enhanced!.prepareReviewedWithdrawal({quoteId:payload.quoteId});const review=await (await normalWithdrawal()).prepareReviewed({quoteId:payload.quoteId});return {intentId:review.preparedId,enhanced:false,review};
      }
      if(command==='authorizeWithdrawal'){
        if(Object.keys(payload).sort().join()!=='enhanced,intentId'||typeof payload.intentId!=='string'||typeof payload.enhanced!=='boolean')fail();
        return await (payload.enhanced?enhanced!.host.authorize({intentId:payload.intentId}):(await normalWithdrawal()).execute({preparedId:payload.intentId}));
      }
      const publicWithdrawal=await normalWithdrawal();
      if(command==='listWithdrawals'){
        if(Object.keys(payload).length&&!(Object.keys(payload).join()==='cached'&&payload.cached===true))fail();
        const cached=payload.cached===true;
        const historyHost=history ? await history.enhanced() : enhanced!;
        const [enhancedRows,withdrawalRows,batchRows]=await Promise.all([
          cached?historyHost.host.listSaved():historyHost.host.list(),
          publicWithdrawal.list(),
          cached?historyHost.publicBatch.listSaved():historyHost.publicBatch.list()
        ]);
        return [...enhancedRows.map(row=>({...row,enhanced:true})),...batchRows.map(row=>({...row,enhanced:false,batch:true})),
          ...withdrawalRows.filter(row=>!['proving','prepared','failed','cancelled','expired-unused'].includes(row.phase)).map(row=>row.batch?normalBatchActivity(row):
            ({transactionId:row.preparedId,enhanced:false,amountAtomic:row.amountAtomic,totalDebitAtomic:row.totalDebitAtomic,
              status:{authorized:['included','finalized'].includes(row.phase),authorizationFailed:row.phase==='failed-finalized',
                finalized:row.phase==='finalized',transactionHash:row.transactionHash}}))];
      }
      if(Object.keys(payload).sort().join()!=='enhanced,transactionId'||typeof payload.transactionId!=='string'||typeof payload.enhanced!=='boolean')fail();
      return payload.enhanced?(history ? await history.enhanced() : enhanced!).host.monitor({transactionId:payload.transactionId}):publicWithdrawal.reconcile({preparedId:payload.transactionId});
    }finally{privateSendAction=false;}
  }
  if (command === "list") {if(Object.keys(payload).length&&!(Object.keys(payload).join()==="cached"&&payload.cached===true))fail();return payload.cached===true?enhanced!.host.listSaved():enhanced!.host.list();}
  if (command === "prepare") {
    if (Object.keys(payload).sort().join() !== "amountAtomic,destination" ||
        typeof payload.amountAtomic !== "string" || typeof payload.destination !== "string") fail();
    return enhanced!.host.prepare(payload as {amountAtomic: string; destination: string});
  }
  if (command === "cancel") {
    if (Object.keys(payload).join() !== "intentId" || typeof payload.intentId !== "string") fail();
    // Current package must expose a verified durable cleanup implementation.
    // Never simulate release or drop the local note reservation on missing SDK support.
    const cancel = (enhanced!.host as typeof enhanced.host & {
      cancel?: (input: {intentId: string}) => Promise<{cancelled: true}>;
    }).cancel;
    if (typeof cancel !== "function") fail();
    return cancel.call(enhanced!.host, {intentId: payload.intentId as string});
  }
  if (command === "authorize") {
    if (Object.keys(payload).join() !== "intentId" || typeof payload.intentId !== "string") fail();
    return enhanced!.host.authorize({intentId: payload.intentId as string});
  }
  if (command === "monitor" || command === "recover") {
    if (Object.keys(payload).join() !== "transactionId" || typeof payload.transactionId !== "string") fail();
    return enhanced!.host[command]({transactionId: payload.transactionId as string});
  }
  fail();
}
let lastId = 0;
scope.addEventListener("message", async ({data, ports}) => {
  if (!data || !Number.isSafeInteger(data.id) || data.id <= lastId || busy) return;
  lastId = data.id; busy = true; const revision = epoch;
  try {
    const result = data.kind === "initialize" ? await initialize(data.config, ports[0]) :
      data.kind === "invoke" && data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
        ? await invokeScoped(data.command, data.payload) : fail();
    live(revision); scope.postMessage({kind: "result", id: data.id, result});
    if (data.command === "quoteWithdrawal" && data.payload?.enhanced === true) {
      setTimeout(() => {
        if (!controller.signal.aborted && revision === epoch) void publicArtifacts?.warmEnhanced().catch(()=>{});
      }, 0);
    }
  } catch (error) {
    // Preparation has released unsigned fences. Never reset a submitting or
    // uncertain transaction; those retain their durable recovery journals.
    if(['prepareReviewedPrivateSend','preparePrivateSend'].includes(data.command)){privateSend?.dispose();privateSend=undefined;}
    if(['prepareReviewedRoute','prepareRoute'].includes(data.command)){const op=data.payload?.operation;if(op===4||op===5){routedHosts.get(op)?.dispose();routedHosts.delete(op);}}
    if(['prepareReviewedWithdrawal','prepareReviewedPublicBatch'].includes(data.command)){publicWithdrawal?.dispose();publicWithdrawal=undefined;}
    const stages:Record<string,string>={selectAsset:'Wallet asset',claimHandle:'Handle claim',checkHandle:'Handle status',findHandle:'Handle recovery',handleAvailable:'Handle availability',currentHandle:'Handle recovery',openPublicPayment:'Wallet session',reconcileDeposit:'Deposit status',quotePrivateSend:'Transfer fee review',prepareReviewedPrivateSend:'Transfer preparation',preparePrivateSend:'Transfer preparation',quoteRouteFees:'Route fee review',prepareReviewedRoute:'Route preparation',prepareRoute:'Route preparation',quotePublicBatch:'Batch fee review',prepareReviewedPublicBatch:'Batch preparation',authorizePublicBatch:'Batch submission',quoteWithdrawal:'Withdrawal fee review',prepareReviewedWithdrawal:'Withdrawal preparation',prepare:'Withdrawal preparation',authorize:'Transaction authorization',authorizeWithdrawal:'Transaction authorization',executePrivateSend:'Transaction authorization',executeRoute:'Transaction authorization'};
    if(stages[data.command])error=depositFailure((error as {cause?:unknown})?.cause??error,stages[data.command]);
    const code = (error as {code?: unknown})?.code;
    const hasBackup = await backend?.hasRecoveryPhrase().catch(() => false) ?? false;
    scope.postMessage({kind: "error", id: data.id,
      code: typeof code === "string" && /^[A-Z_]{1,64}$/u.test(code) ? code : "RUNTIME_UNAVAILABLE", hasBackup, depositFailure:publicDepositFailure(error)});
    if (data.kind === "initialize") dispose();
  } finally {busy = false;}
});
