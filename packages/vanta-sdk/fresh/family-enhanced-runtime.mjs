import{quoteFamilyOperationFees,assertFamilyReviewedFees,familyTotalSpendAmounts} from './family-operation-review.mjs';
import {allocateFamilyBatchPayouts} from './family-batch-review.mjs';
/** Concrete enhanced wallet composition. One local authorization commits an
 * existing proof and its fixed claims. Monitoring never reproves funding. */
import { createEnhancedWithdrawalHostCore } from "./enhanced-host-core.mjs";
import { createVantaEnhancedFundingRuntime } from "./family-enhanced-funding-runtime.mjs";
import {createVantaFamilyEnhancedComponents} from "./family-enhanced-components.mjs";
import {createVantaFamilyEnhancedFeeProver} from "./family-enhanced-fees.mjs";
import {readVantaFamilyProtocolFees} from "./family-fee-policy.mjs";
import {getCompiledFamilyEvmRelease,isFamilyWithdrawalOnlyContext} from './family-network.mjs';
import {getCompiledVantaFamilyProofResources} from './family-proof-resources.mjs';
import {selectVantaFamilyFundingResources} from './family-funding-resources.mjs';
import {createFamilySpendFence} from './family-spend-fence.mjs';
import {recoverFamilyBalanceSummary} from './family-balance-projection.mjs';
import {reconcileFamilyUnsignedReservations} from './family-unsigned-reservations.mjs';
import { createFamilyNoteDelivery } from "./family-note-delivery.mjs";
import { recoverFamilyCanonicalNotes } from "./family-note-recovery.mjs";
import { createEnhancedWalletJournal } from "./enhanced-wallet-journal.mjs";
import { buildEnhancedPrivatePlan, proveEnhancedPrivatePlan, selectEnhancedNotes, validateEnhancedFeeReview } from "./family-enhanced-plan.mjs";
import { pendingEnhancedStatus, reconcileEnhancedPlan, reconcilePublicBatchPlan } from "./family-enhanced-reconcile.mjs";
import { enhancedAddress as address, enhancedAmount as amount, enhancedClone as clone, enhancedSame as same,
  enhancedFail as fail, enhancedPoolAbi as ABI, encodeEnhancedFundingProof, enhancedPublicBatch,
  enhancedRandomField } from "./family-enhanced-wire.mjs";

const now = () => Math.floor(Date.now() / 1000);
const phases = ["preparing", "prepared", "proving", "submitting", "tracking", "failed"];
const identifier = v => { if (!/^[A-Za-z0-9_-]{1,128}$/u.test(v ?? "")) fail(); return v; };

/** Called only after the host core has persisted its cancellation fence. */
export function releaseEnhancedUnsignedPreparation(rows,{intentId,preparedId,subjectId}){
  const row=rows.find(r=>r.intentId===intentId);
  if(!row||row.preparedId!==preparedId||row.subjectId!==subjectId||row.journalArmed||row.calldata)fail();
  // Balance recovery may already have expired this exact unsigned record.
  // A durable host cancellation can acknowledge that release idempotently.
  if(row.phase==="failed"&&["cancelled","expired-unsigned"].includes(row.failure))return {next:rows,result:{released:true}};
  if(row.phase!=="prepared")fail();
  return {next:rows.map(r=>r===row?{...r,phase:"failed",failure:"cancelled"}:r),result:{released:true}};
}

export function expireEnhancedUnsignedPreparations(rows, timestamp) {
  const expired = r => r.phase === 'prepared' && r.expiresAt <= timestamp && !r.journalArmed && !r.calldata;
  const next = rows.map(r => expired(r) ? {...r,phase:'failed',failure:'expired-unsigned'} : r);
  return {next,result:next.filter(r => r.phase === 'failed' && r.failure === 'expired-unsigned' && !r.journalArmed && !r.calldata).map(r => r.intentId)};
}

/** Internal disposable constructor. All executable bytes and deployment
 * identities come from separately compiled inventories, never options. */
export async function createVantaEnhancedCandidateHost({ wallet, store, provider, verificationProvider, relay,
  artifactBaseUrl, fetcher, journalStore, getSession, signal, onProgress, asset="native",releaseContext,getReviewDisplayCache } = {}) {
  if (!wallet || typeof wallet.privateWalletKeys !== "function" || !store || typeof store.read !== "function" ||
      typeof store.transact !== "function" || !store.scope?.startsWith("vanta-host-v1/") ||
      !provider || !verificationProvider || provider === verificationProvider || typeof getSession !== "function" ||
      !relay || ["submit", "submissionStatus", "monitor", "recover"].some(k => typeof relay[k] !== "function") ||
      ["prepare", "prepareBatch", "terms", "bind", "bindBatch", "sign"].some(k => typeof relay[k] !== "function")) fail();
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
  let funding, components, fees, journal, closed = false, acceptedReview=null, reviewing=false;
  const reviews=new Map(), authorizationPreparations=new Map();
  const live = () => { controller.signal.throwIfAborted(); if (closed) fail(); };
  const dispose = () => { closed = true; controller.abort(); authorizationPreparations.clear(); funding?.dispose(); components?.dispose(); fees?.dispose(); relay?.dispose(); journal?.close(); signal?.removeEventListener("abort", abort); };
  try {
    funding = await createVantaEnhancedFundingRuntime({ artifactBaseUrl, fetcher, signal: controller.signal, onProgress,asset,releaseContext });
    const resources=funding.resources;
    const d = resources.deployment, native = resources.profiles.normal8.runtime;
    const domain = Object.freeze({ schema: "vanta-family-note-domain-v1", safeForFunds: false,
      chainId: resources.chainId, familyTag: resources.familyTag, genesisHash: resources.genesisHash,
      generationId: resources.generationId, setupId: d.setupId, pool: d.pool, asset: d.asset, poolCodehash: d.poolCodehash,
      nativeGlueSha256: native.glue.sha256, nativeWasmSha256: native.wasm.sha256 });
    const context = Object.freeze({ networkId: `eip155:${domain.chainId}`, generationId: domain.generationId,
      pool: domain.pool, assetAddress: domain.asset, assetSymbol: d.assetSymbol, assetDecimals: d.assetDecimals });
    if (!store.scope.endsWith(`/${context.networkId}/${context.generationId}`)) fail();
    components=await createVantaFamilyEnhancedComponents({provider,verificationProvider,pool:domain.pool,artifactBaseUrl,fetcher,signal:controller.signal,releaseContext});
    fees=await createVantaFamilyEnhancedFeeProver({provider,verificationProvider,artifactBaseUrl,fetcher,signal:controller.signal,onProgress,releaseContext});
    const noteEngine=await funding.noteEngine(),delivery=createFamilyNoteDelivery({domain,engine:noteEngine});
    const release=getCompiledFamilyEvmRelease(releaseContext),allResources=getCompiledVantaFamilyProofResources(release,releaseContext),
      balanceResources=[resources,...allResources.funding.pools.filter(p=>p.pool!==d.pool).map(p=>
        selectVantaFamilyFundingResources(release,allResources,BigInt(p.asset)===0n?'native':p.asset))];
    const balanceDeliveries=new Map([[d.pool,delivery]]);
    journal = await createEnhancedWalletJournal({ domain, wallet, delivery, claimRuntime: components,
      provider, verificationProvider, deploymentBlock: d.deploymentBlock, store: journalStore });
    const namespace = `enhanced-funding-preparations-v1/${domain.pool}`;
    const fences=createFamilySpendFence({store,pool:domain.pool});
    const sessionFor = (permission, input, debit) => {
      live(); const session = getSession();
      if (!session || !Array.isArray(session.permissions) || !session.permissions.includes(permission) ||
          !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now()) fail();
      identifier(session.subjectId); identifier(session.sessionId);
      const maximum = amount(session.maximumDebitAtomic); amount(session.maximumSessionDebitAtomic);
      if (debit !== undefined && amount(debit) > maximum) fail();
      if (input && session.allowedDestinations !== null) {
        if (!Array.isArray(session.allowedDestinations)) fail();
        const allowed = session.allowedDestinations.map(address), destinations = input.payments?.map(p => p.recipient) ?? [input.destination];
        if (destinations.some(v => !allowed.includes(address(v)))) fail();
      }
      return session;
    };
    const validRows = rows => {
      if (!Array.isArray(rows) || rows.length > 256 || new Set(rows.map(r => r?.intentId)).size !== rows.length) fail();
      for (const r of rows) {
        if (r.schema !== "vanta-enhanced-funding-preparation-v1" || !same(r.domain, domain) || !phases.includes(r.phase) ||
            !Number.isSafeInteger(r.expiresAt) || !Array.isArray(r.nullifiers)) fail();
        identifier(r.intentId); identifier(r.preparedId); identifier(r.requestId);
        if (!/^[A-Za-z0-9_-]{8,128}$/u.test(r.requestId) ||
            (r.plan && (r.plan.quote.requestId !== r.requestId || (![`${r.intentId}_8`,`${r.intentId}_32`].includes(r.requestId)&&!/^review_[0-9a-f]{64}_(8|32)$/u.test(r.requestId))))) fail();
      }
      return rows;
    };
    const update = work => { live(); return store.transact(namespace, rows => { live(); return work(validRows(rows)); }); };
    const read = async id => {
      live(); const record = validRows(await store.read(namespace)).find(r => r.intentId === identifier(id));
      live(); if (!record) fail(); return record;
    };
    const checkContext = value => {
      if (!value || value.networkId !== context.networkId || value.generationId !== context.generationId ||
          address(value.pool) !== context.pool || address(value.assetAddress) !== context.assetAddress ||
          value.assetSymbol !== context.assetSymbol || value.assetDecimals !== context.assetDecimals) fail();
      live();
    };
    const recovery = async (displayCache,signal) => {
      signal?.throwIfAborted();
      // Only unsigned, expired preparations can release their local note locks.
      // Armed/uncertain submissions keep their fences until reconciliation.
      const expired = await update(rows => expireEnhancedUnsignedPreparations(rows,now()));
      for (const id of expired) await fences.releaseUnsigned(id);
      live(); const inventory = await recoverFamilyCanonicalNotes({ provider, verificationProvider, delivery, wallet, deploymentBlock: d.deploymentBlock, displayCache,signal });
      signal?.throwIfAborted();live(); if (!inventory.complete) fail(); return inventory;
    };
    const bound = async intent => {
      checkContext(intent.context); const r = await read(intent.intentId);
      if (r.preparedId !== intent.preparedId || !r.plan || !same(intent.input, r.input) || !same(intent.schedule, r.schedule) ||
          !same(intent.review, r.plan.review) || (r.intentBinding !== null && r.intentBinding !== intent.intentBinding)) fail();
      return r;
    };
    const set = (id, work) => update(rows => {
      const found = rows.find(r => r.intentId === id); if (!found) fail();
      const value = work(found); return { next: rows.map(r => r === found ? value : r), result: value };
    });
    const observe = async record => {
      const reconcile = record.operation === "public-batch" ? reconcilePublicBatchPlan : reconcileEnhancedPlan;
      const status = await reconcile({ provider, verificationProvider, domain, record, relay, journal, deploymentBlock: d.deploymentBlock });
      live(); await set(record.intentId, r => ({ ...r,lastObservedStatus:clone(status), phase: status.authorizationFailed ? "failed" : status.authorized ? "tracking" : r.phase }));
      if(status.authorizationFailed||status.finalized||status.completed===3)await fences.finish(record.intentId);
      return status;
    };
    const runtime = {
      async getPolicy(value) { checkContext(value); return resources.deployment.hostPolicy; },
      async cancelPrepared(intent){
        const record=await bound(intent),permissions=getSession()?.permissions;
        const session=sessionFor(permissions?.includes("cancel")?"cancel":"prepare");
        const result=await update(rows=>releaseEnhancedUnsignedPreparation(rows,{intentId:record.intentId,preparedId:record.preparedId,subjectId:session.subjectId}));
        authorizationPreparations.delete(record.intentId);
        await fences.releaseUnsigned(record.intentId);return result;
      },
      async assertAuthorizationIsolation(intent){
        const record=await bound(intent),authority=sessionFor("authorize",intent.input,intent.review.totalDebitAtomic);
        if(record.phase!=="prepared"||record.subjectId!==authority.subjectId||record.sessionId!==authority.sessionId)return false;
        // The encrypted CAS fence rejects any overlap with an older armed or
        // uncertain spend; disjoint notes need not wait for its payout window.
        await fences.reserve({id:record.intentId,nullifiers:record.nullifiers});
        live();return true;
      },
      async prepare(request) {
        checkContext(request.context);
        const isBatch = request.operation === "public-batch", session = sessionFor("prepare", request.input), stamp = JSON.stringify(session);
        if(isBatch&&isFamilyWithdrawalOnlyContext(releaseContext))fail();
        const policy = resources.deployment.hostPolicy;
        let selected, quote, inventory;
        for (const width of (acceptedReview?[acceptedReview.width]:[8,32])) {
          const requestId=acceptedReview?.requestId??`${identifier(request.intentId)}_${width}`;
          // Independent fresh reads and the exact relayer quote can run together.
          // All results are checked before selecting or reserving any input.
          let response,protocolPolicy,fresh;
          [inventory,response,protocolPolicy,fresh]=await Promise.all([
            recovery(),
            acceptedReview?.rawQuote??(isBatch?relay.prepareBatch({requestId,width,batch:enhancedPublicBatch(request.input.payments,domain.pool).batch}):
              relay.prepare({requestId,width,netPayoutAtomic:request.input.amountAtomic})),
            readVantaFamilyProtocolFees({provider,verificationProvider,pool:domain.pool,releaseContext}),
            acceptedReview?quoteFamilyOperationFees({provider,verificationProvider,releaseContext,asset,partnerHandle:acceptedReview.input.partnerHandle,operation:isBatch?3:0,amountAtomic:request.input.amountAtomic}):null]);
          quote={...validateEnhancedFeeReview(response,request.input.amountAtomic,width,isBatch),requestId};
          if (quote.policy.protocolBps !== protocolPolicy.rates[isBatch?3:0] ||
              quote.policy.feePolicyHash !== protocolPolicy.policyHash) fail();
          if(acceptedReview){
            if(isBatch===acceptedReview.enhanced||request.input.amountAtomic!==acceptedReview.quote.netPayoutAtomic||
              (isBatch?!same(request.input.payments,acceptedReview.input.payments):address(request.input.destination)!==address(acceptedReview.input.destination)))fail();
            assertFamilyReviewedFees(acceptedReview.fees,fresh);
            if(quote.protocolFeeAtomic!==acceptedReview.quote.protocolFeeAtomic||quote.partnerFeeAtomic!==acceptedReview.quote.partnerFeeAtomic||quote.gasReserveAtomic!==acceptedReview.quote.gasReserveAtomic||quote.totalDebitAtomic!==acceptedReview.quote.totalDebitAtomic)throw Error('Family fee review: The fees changed. Review the current fees again.');
          }
          const active = await journal.list(), globalLocks = await fences.blocked();
          for (const row of active) if (row.phase !== "expired-unused") {
            const saved = await journal.readPrivate(row.preparedId), parsed = ABI.parseTransaction({ data: saved.calldata });
            const status = !["included", "finalized"].includes(row.phase) && Number(parsed.args[0].deadline) < now()
              ? await journal.reconcile(row.preparedId) : row;
            if (status.phase !== "expired-unused") saved.nullifiers.forEach(n => globalLocks.add(n));
          }
          selected = await update(rows => {
            if (rows.some(r => r.intentId === request.intentId) || rows.length >= 256) fail();
            const blocked = new Set([...globalLocks, ...rows.filter(r => r.phase !== "failed" &&
              (!(["preparing", "prepared"].includes(r.phase)) || r.expiresAt > now())).flatMap(r => r.nullifiers)]);
            const picked = selectEnhancedNotes(inventory, blocked, amount(quote.totalDebitAtomic)+1n, width);
            if (!picked) return { next: rows, result: null };
            return { next: [...rows, { schema: "vanta-enhanced-funding-preparation-v1", domain,
              intentId: request.intentId, requestId:quote.requestId, preparedId: quote.id, phase: "preparing", expiresAt: request.expiresAt,
              operation: isBatch ? "public-batch" : "enhanced", subjectId: session.subjectId, sessionId: session.sessionId,
              input: clone(request.input), schedule: clone(request.schedule), nullifiers: picked.notes.map(n => n.nullifier),
              intentBinding: null, plan: null, calldata: null, journalArmed: false, failure: null }], result: picked };
          });
          if (selected) break;
        }
        if (!selected) throw Error("No available source epoch contains enough unlocked notes.");
        try {
          await fences.reserve({id:request.intentId,nullifiers:selected.notes.map(n=>n.nullifier)});
          const {plan,preparedAuthorization} = await buildEnhancedPrivatePlan({ provider, domain, wallet, delivery, funding, components, fees, relay,
            request, quote, selected, inventory, policy });
          live(); if (plan.review.expiresAt <= now()) fail();
          if (JSON.stringify(sessionFor("prepare", request.input, plan.review.totalDebitAtomic)) !== stamp) fail();
          await set(request.intentId, r => {
            if (r.phase !== "preparing") fail(); return { ...r, plan, phase: "prepared", expiresAt: plan.review.expiresAt };
          });
          // The proving component owns this in-memory preparation. The
          // encrypted journal retains its witness for a restart or eviction.
          if(preparedAuthorization){
            if(authorizationPreparations.size>=4)authorizationPreparations.delete(authorizationPreparations.keys().next().value);
            authorizationPreparations.set(request.intentId,{digest:plan.signedDigest,preparedAuthorization});
          }
          return { preparedId: quote.id, review: clone(plan.review) };
        } catch (error) {
          await set(request.intentId, r => r.phase === "preparing" ? { ...r, phase: "failed", failure: "before-submission" } : r);
          await fences.releaseUnsigned(request.intentId);
          throw error;
        }
      },
      async authorize(intent) {
        const initial = await bound(intent), authority = sessionFor("authorize", intent.input, intent.review.totalDebitAtomic), session = JSON.stringify(authority);
        if (initial.subjectId !== authority.subjectId || initial.sessionId !== authority.sessionId) fail();
        const assertAuthority = () => {
          live(); const current = sessionFor("authorize", intent.input, intent.review.totalDebitAtomic);
          if (JSON.stringify(current) !== session ||
              intent.review.expiresAt <= now()) fail();
        };
        assertAuthority();
        if (initial.phase !== "prepared") fail();
        // Existing KZG preparations remain resumable after a software-only
        // upgrade. Adopt their original note locks before generating a proof.
        await fences.reserve({id:intent.intentId,nullifiers:initial.nullifiers});
        await update(rows => {
          assertAuthority(); const r = rows.find(row => row.intentId === intent.intentId);
          if (!r || r.phase !== "prepared" || rows.some(row => row.intentId!==intent.intentId &&
              ["proving", "submitting"].includes(row.phase) && row.nullifiers.some(n=>r.nullifiers.includes(n)))) fail();
          const spent = rows.filter(row => row.subjectId === authority.subjectId && row.sessionId === authority.sessionId &&
            ["proving", "submitting", "tracking"].includes(row.phase)).reduce((sum, row) => sum + amount(row.plan.review.totalDebitAtomic), 0n);
          if (spent + amount(intent.review.totalDebitAtomic) > amount(authority.maximumSessionDebitAtomic)) fail();
          const next = { ...r, phase: "proving", intentBinding: intent.intentBinding };
          return { next: rows.map(row => row === r ? next : row), result: undefined };
        });
        try {
          const inventory = await recovery();
          if (initial.nullifiers.some(n => !inventory.notes.some(note => note.nullifier === n && note.status === "spendable"))) fail();
          const plan = initial.plan, cached = authorizationPreparations.get(intent.intentId);
          authorizationPreparations.delete(intent.intentId);
          const proofs = await proveEnhancedPrivatePlan({ wallet, funding, components, fees, relay, plan, inventory, assertAuthority,
            preparedAuthorization:cached?.digest===plan.signedDigest?cached.preparedAuthorization:undefined });
          const proofBytes = encodeEnhancedFundingProof({ ...plan, ...proofs });
          const isBatch = plan.operation === "public-batch";
          const calldata = ABI.encodeFunctionData(isBatch ? "settlePublicBatch" : "authorizeEnhanced",
            [plan.header, proofBytes, ...(isBatch ? [plan.publicBatch] : []), proofs.signature]).toLowerCase();
          assertAuthority();
          await journal.reserve({ preparedId: initial.preparedId, intentId: intent.intentId, intentBinding: intent.intentBinding,
            calldata, nullifiers: plan.preview.nullifiers, inputCommitments: plan.selected.notes.map(n => n.commitment),
            recipient: isBatch ? domain.pool : intent.input.destination, netPayoutAtomic: plan.review.netPayoutAtomic, totalDebitAtomic: plan.review.totalDebitAtomic,
            capabilities: plan.claims.map(c => c.capability) });
          // Persist this barrier before arming or sending. A crash after either
          // step resumes read-only reconciliation against the original calldata.
          await set(intent.intentId, r => ({ ...r, calldata, journalArmed: true }));
          await journal.arm(initial.preparedId, intent.intentBinding);
          await fences.arm(intent.intentId);
          assertAuthority();
          await set(intent.intentId, r => ({ ...r, phase: "submitting" }));
          assertAuthority();
          const sent = await relay.submit({intentId:intent.intentId,requestId:initial.requestId,calldata});
          live(); await journal.recordTransactionHash(initial.preparedId, sent.transactionHash);
          // A persisted relayer hash acknowledges submission. History verifies
          // canonical inclusion and the three payouts while the notes stay fenced.
          if (!isBatch) return pendingEnhancedStatus();
          return observe(await read(intent.intentId));
        } catch (error) {
          if(error?.code==="ENHANCED_INPUTS_RESERVED"){
            await journal.closeUnsubmitted(initial.preparedId,intent.intentBinding);
            await set(intent.intentId,r=>({...r,phase:"failed",failure:"inputs-reserved"}));
            await fences.finish(intent.intentId);
            return {...pendingEnhancedStatus(true),failure:"inputs-reserved"};
          }
          await set(intent.intentId, r => !r.journalArmed ? { ...r, phase: "failed", failure: "before-submission" } : r);
          if(!(await read(intent.intentId)).journalArmed)await fences.releaseUnsigned(intent.intentId);
          throw error;
        }
      },
      monitor: async intent => observe(await bound(intent)),
      async recover(intent) {
        const record = await bound(intent), status = await observe(record);
        if (record.operation === "public-batch" || !status.authorized || status.completed === 3) return status;
        // The queue already owns exactly these capabilities. It refreshes only
        // shared public roots and signs executor transactions, never wallet auth.
        await relay.recover({ requestId: record.requestId }); live();
        return observe(await read(intent.intentId));
      },
    };
    // Balance recovery runs explicitly/background; every funded path below still
    // reconstructs canonical spendable notes before preparation or authorization.
    live();
    const host = createEnhancedWithdrawalHostCore({ context, store, runtime, getSession }, checkContext);
    const batchIntent = row => ({ context, intentId: row.intentId, preparedId: row.preparedId, input: row.input,
      schedule: null, review: row.plan.review, intentBinding: row.intentBinding });
    const ownBatch = async (id, permission) => {
      const session = sessionFor(permission), row = await read(identifier(id));
      if (row.operation !== "public-batch" || row.subjectId !== session.subjectId) fail();
      return row;
    };
    const publicBatch = Object.freeze({ context,
      async prepare(raw) {
        if (!raw || Object.keys(raw).join() !== "payments") fail();
        const { batch, totalAtomic } = enhancedPublicBatch(raw.payments, domain.pool),
          input = { amountAtomic: totalAtomic, payments: batch.recipients.map((recipient, i) => ({ recipient, amountAtomic: batch.amounts[i] })) };
        const session = sessionFor("prepare", input), stamp = JSON.stringify(session), policy = await runtime.getPolicy(context);
        if (!Number.isSafeInteger(policy.reviewTtlSeconds) || policy.reviewTtlSeconds < 1 || policy.reviewTtlSeconds > 900) fail();
        const intentId = "batch_" + enhancedRandomField().slice(2), expiresAt = Math.min(now() + policy.reviewTtlSeconds, session.expiresAt);
        if (JSON.stringify(sessionFor("prepare", input)) !== stamp) fail();
        const result = await runtime.prepare({ context, intentId, operation: "public-batch", input, schedule: null, expiresAt });
        await set(intentId, row => ({ ...row, intentBinding: enhancedRandomField() }));
        if (JSON.stringify(sessionFor("prepare", input, result.review.totalDebitAtomic)) !== stamp) fail();
        return Object.freeze({...result.review,payments:clone(input.payments)});
      },
      async authorize({ intentId, ...extra } = {}) {
        if (Object.keys(extra).length) fail(); const row = await ownBatch(intentId, "authorize");
        const status = await runtime.authorize(batchIntent(row)); return { transactionId: row.intentId, status };
      },
      async monitor({ transactionId, ...extra } = {}) {
        if (Object.keys(extra).length) fail(); const row = await ownBatch(transactionId, "monitor");
        if (["preparing", "prepared"].includes(row.phase)) fail(); return runtime.monitor(batchIntent(row));
      },
      async recover({ transactionId, ...extra } = {}) {
        if (Object.keys(extra).length) fail(); const row = await ownBatch(transactionId, "recover");
        if (["preparing", "prepared"].includes(row.phase)) fail(); return runtime.recover(batchIntent(row));
      },
      async listSaved() {
        const session=sessionFor('monitor'),rows=validRows(await store.read(namespace));sessionFor('monitor');
        return rows.filter(row=>row.operation==='public-batch'&&row.plan&&row.subjectId===session.subjectId&&!["preparing","prepared"].includes(row.phase)).map(row=>({
          transactionId:row.intentId,payments:clone(row.input.payments),amountAtomic:row.input.amountAtomic,totalDebitAtomic:row.plan.review.totalDebitAtomic,
          status:clone(row.lastObservedStatus??{authorized:false,authorizationFailed:false,finalized:false,transactionHash:null})}));
      },
      async list() {
        const session = sessionFor("monitor"), rows = validRows(await store.read(namespace)), result = [];
        for (const row of rows) if (row.operation === "public-batch" && row.plan && row.subjectId === session.subjectId &&
          !["preparing", "prepared"].includes(row.phase)) result.push({ transactionId: row.intentId,
            payments:clone(row.input.payments),amountAtomic:row.input.amountAtomic,totalDebitAtomic:row.plan.review.totalDebitAtomic,
            status: await publicBatch.monitor({ transactionId: row.intentId }) });
        return result;
      },
    });
    const hostNamespace = `enhanced-withdrawals-v1/${domain.pool}/${domain.asset}`;
    let warming;
    const warmProofRuntime=()=>{live();warming??=Promise.all([funding.warm({width:8}),funding.warm({width:32}),fees.warmProofRuntime(),components.warmProofRuntime()])
      .then(()=>{live();}).catch(error=>{warming=undefined;throw error;});return warming;};
    const quoteWithdrawal=async(input)=>{
      live();if(!input||Object.keys(input).sort().join()!=='amountAtomic,destination,enhanced,partnerHandle'||input.enhanced!==true)fail();
      const n=amount(input.amountAtomic),destination=address(input.destination);if(n<3n||destination===address(domain.pool))throw Error('Family fee review: Enter a valid public recipient and amount.');
      const authority=sessionFor('prepare',{destination}),operation=input.enhanced?0:3;
      const policy=quoteFamilyOperationFees({provider,verificationProvider,releaseContext,asset,partnerHandle:input.partnerHandle,operation,amountAtomic:'3'});
      const requestGas=width=>{
        const requestId='review_'+enhancedRandomField().slice(2)+'_'+width;
        return {requestId,pending:relay.quote({requestId,width})};
      };
      // The gas review is width-bound but does not depend on any selected note,
      // amount, or destination. Start the usual width while recovery runs.
      const standardGas=requestGas(8);
      void standardGas.pending.catch(()=>{});
      const review=async()=>{
        // Recovery releases expired unsigned reservations before note selection.
        const inventory=await recovery(getReviewDisplayCache?.()),blocked=await fences.blocked();
        live();
        for(const width of[8,32]){
          const selected=selectEnhancedNotes(inventory,blocked,n,width);if(!selected)continue;
          const available=BigInt(selected.totalAtomic)-1n,maximumDebitAtomic=(n<available?n:available).toString();
          const {requestId,pending}=width===8?standardGas:requestGas(width);
          const [gas,publicFees]=await Promise.all([pending,policy]);
          if(gas?.schema!=='vanta-enhanced-gas-review-v1'||gas.pool!==domain.pool||gas.generationId!==domain.generationId||gas.width!==width||
            typeof gas.gasReserveAtomic!=='string'||!/^([1-9][0-9]{0,36})$/u.test(gas.gasReserveAtomic)||gas.deadline<=now()+30)fail();
          const amounts=familyTotalSpendAmounts({maximumDebitAtomic,gasReserveAtomic:gas.gasReserveAtomic,feeRules:publicFees.feeRules});
          if(BigInt(amounts.amountAtomic)<3n)throw Error('Family fee review: The entered amount does not cover fees and three positive payouts.');
          if(!selectEnhancedNotes(inventory,blocked,BigInt(amounts.totalDebitAtomic),width))continue;
          const net=BigInt(amounts.amountAtomic),fees={...publicFees,amountAtomic:amounts.amountAtomic,protocolFeeAtomic:amounts.protocolFeeAtomic,partnerFeeAtomic:amounts.partnerFeeAtomic,totalDebitAtomic:(net+BigInt(amounts.protocolFeeAtomic)+BigInt(amounts.partnerFeeAtomic)).toString()};
          const quote=Object.freeze({quoteId:enhancedRandomField(),grossAmountAtomic:input.amountAtomic,netPayoutAtomic:amounts.amountAtomic,protocolFeeAtomic:amounts.protocolFeeAtomic,partnerFeeAtomic:amounts.partnerFeeAtomic,gasReserveAtomic:gas.gasReserveAtomic,totalDebitAtomic:amounts.totalDebitAtomic,asset:d.assetSymbol,destination,enhanced:true,windowSeconds:d.hostPolicy.windowEpochs*60,expiresAt:Math.min(now()+300,gas.deadline,authority.expiresAt)});
          return {quote,fees,input:structuredClone({...input,amountAtomic:amounts.amountAtomic,destination}),enhanced:true,rawQuote:null,requestId,width};
        }
        throw Error('Family withdrawal: The amount exceeds the unlocked balance available for one transaction. Pending transactions keep their notes reserved.');
      };
      const [saved]=await Promise.all([review(),policy]);live();
      if(reviews.size>=4)reviews.delete(reviews.keys().next().value);reviews.set(saved.quote.quoteId,saved);
      // Let quote delivery complete before starting public proof downloads.
      setTimeout(()=>{if(!controller.signal.aborted)void warmProofRuntime().catch(()=>{});},0);
      return saved.quote;
    };
    const quotePublicBatch=async(input)=>{
      live();if(!input||Object.keys(input).sort().join()!=='partnerHandle,payments')fail();
      void warmProofRuntime().catch(()=>{});
      const normalized=enhancedPublicBatch(input.payments,domain.pool),payments=normalized.batch.recipients.map((recipient,i)=>({recipient,amountAtomic:normalized.batch.amounts[i]}));
      const partnerHandle=input.partnerHandle;
      const gross=BigInt(normalized.totalAtomic),authority=sessionFor('prepare',{payments});
      const [publicFees,inventory]=await Promise.all([
        quoteFamilyOperationFees({provider,verificationProvider,releaseContext,asset,partnerHandle,operation:3,amountAtomic:'3'}),recovery(getReviewDisplayCache?.())]);
      const blocked=await fences.blocked();
      for(const width of[8,32]){
        const selected=selectEnhancedNotes(inventory,blocked,gross,width);if(!selected)continue;
        const available=BigInt(selected.totalAtomic)-1n,maximumDebitAtomic=(gross<available?gross:available).toString();
        const requestId='review_'+enhancedRandomField().slice(2)+'_'+width;
        const gas=await relay.quote({requestId,width,batch:normalized.batch});
        if(gas?.schema!=='vanta-enhanced-gas-review-v1'||gas.operation!=='public-batch'||!same(gas.batchRecipients,normalized.batch.recipients)||
          gas.pool!==domain.pool||gas.generationId!==domain.generationId||gas.width!==width||typeof gas.gasReserveAtomic!=='string'||
          !/^([1-9][0-9]{0,36})$/u.test(gas.gasReserveAtomic)||gas.deadline<=now()+30)fail();
        const amounts=familyTotalSpendAmounts({maximumDebitAtomic,gasReserveAtomic:gas.gasReserveAtomic,feeRules:publicFees.feeRules});
        const allocated=allocateFamilyBatchPayouts(payments,amounts.amountAtomic);
        if(!selectEnhancedNotes(inventory,blocked,BigInt(amounts.totalDebitAtomic),width))continue;
        const fees={...publicFees,amountAtomic:amounts.amountAtomic,protocolFeeAtomic:amounts.protocolFeeAtomic,partnerFeeAtomic:amounts.partnerFeeAtomic,
          totalDebitAtomic:(BigInt(amounts.amountAtomic)+BigInt(amounts.protocolFeeAtomic)+BigInt(amounts.partnerFeeAtomic)).toString()};
        const quote=Object.freeze({quoteId:enhancedRandomField(),grossAmountAtomic:normalized.totalAtomic,netPayoutAtomic:amounts.amountAtomic,
          protocolFeeAtomic:amounts.protocolFeeAtomic,partnerFeeAtomic:amounts.partnerFeeAtomic,gasReserveAtomic:gas.gasReserveAtomic,totalDebitAtomic:amounts.totalDebitAtomic,
          asset:d.assetSymbol,payments:allocated,expiresAt:Math.min(now()+300,gas.deadline,authority.expiresAt)});
        if(reviews.size>=4)reviews.delete(reviews.keys().next().value);
        reviews.set(quote.quoteId,{kind:'batch',quote,fees,input:{partnerHandle,payments:allocated.map(({recipient,amountAtomic})=>({recipient,amountAtomic}))},enhanced:false,rawQuote:null,requestId,width});
        return quote;
      }
      throw Error('Batch send: Insufficient unlocked private balance for the amount and fees.');
    };
    return Object.freeze({ host, publicBatch, dispose,quoteWithdrawal,quotePublicBatch,
      async prepareReviewedPublicBatch({quoteId}){
        live();const selected=reviews.get(quoteId);if(selected?.kind!=='batch'||selected.quote.expiresAt<=now()+30)throw Error('Batch send: Review the current fees again.');
        if(reviewing)throw Error('Another withdrawal is being prepared.');reviews.delete(quoteId);reviewing=true;acceptedReview=selected;
        try{return await publicBatch.prepare({payments:selected.input.payments});}finally{reviewing=false;acceptedReview=null;}
      },
      async prepareReviewedWithdrawal({quoteId}){
        live();const selected=reviews.get(quoteId);if(!selected||selected.kind==='batch'||selected.quote.expiresAt<=now()+30)throw Error('Family fee review: Review the current withdrawal fees again.');
        if(reviewing)throw Error('Family withdrawal: Another withdrawal is being prepared.');reviews.delete(quoteId);reviewing=true;acceptedReview=selected;
        try{const review=selected.enhanced?await host.prepare({amountAtomic:selected.input.amountAtomic,destination:selected.input.destination}):await publicBatch.prepare({payments:[{recipient:selected.input.destination,amountAtomic:selected.input.amountAtomic}]});return Object.freeze({...review,enhanced:selected.enhanced});}
        finally{reviewing=false;acceptedReview=null;}
      },
      async exportRecoveryBackup() {
        sessionFor("recover");
        const preparations = validRows(await store.read(namespace)).filter(row => row.journalArmed), ids = new Set(preparations.map(row => row.preparedId));
        const hostIntents = (await store.read(hostNamespace)).filter(row => ids.has(row.preparedId));
        const backup = await journal.exportRecoveryBackup({ schema: "vanta-enhanced-host-recovery-v1", storageScope: store.scope,
          domain, preparations, hostIntents });
        sessionFor("recover"); return backup;
      },
      async importRecoveryBackup(backup) {
        sessionFor("recover");
        const restored = await journal.importRecoveryBackup(backup);
        if (!restored || Object.keys(restored).sort().join() !== "domain,hostIntents,preparations,schema,storageScope" ||
            restored.schema !== "vanta-enhanced-host-recovery-v1" || restored.storageScope !== store.scope ||
            !same(restored.domain, domain) || !Array.isArray(restored.hostIntents) || restored.hostIntents.length > 256) fail();
        const preparations = validRows(restored.preparations);
        if (preparations.some(row => !row.journalArmed || !row.plan || !row.calldata || row.intentBinding === null)) fail();
        await update(rows => {
          const next = rows.slice();
          for (const row of preparations) {
            const current = next.find(value => value.intentId === row.intentId || value.preparedId === row.preparedId);
            if (current) {
              if (current.intentId !== row.intentId || current.preparedId !== row.preparedId || current.calldata !== row.calldata ||
                  current.intentBinding !== row.intentBinding || !same(current.plan, row.plan)) fail();
              continue;
            }
            if (next.some(value => value.phase !== "failed" && value.nullifiers.some(n => row.nullifiers.includes(n)))) fail();
            next.push({ ...row, phase: "submitting" });
          }
          return { next, result: undefined };
        });
        for(const row of preparations){
          await fences.reserve({id:row.intentId,nullifiers:row.nullifiers});await fences.arm(row.intentId);
        }
        await store.transact(hostNamespace, rows => {
          live(); const next = rows.slice();
          for (const row of restored.hostIntents) {
            const prepared = preparations.find(p => p.intentId === row.intentId && p.operation === "enhanced");
            if (!prepared || row.schema !== "vanta-enhanced-host-intent-v1" || row.preparedId !== prepared.preparedId ||
                row.intentBinding !== prepared.intentBinding || row.subjectId !== prepared.subjectId ||
                !same(row.input, prepared.input) || !same(row.review, prepared.plan.review)) fail();
            const current = next.find(value => value.intentId === row.intentId);
            if (current) { if (current.intentBinding !== row.intentBinding) fail(); continue; }
            next.push({ ...row, phase: "uncertain", revision: row.revision + 1, status: { completed: 0, total: 3,
              progress: "0/3", authorized: false, authorizationFailed: false, recoveryRequired: true,
              claims: [1, 2, 3].map(number => ({ number, state: "waiting", transactionHash: null })) } });
          }
          if (next.length > 4096) fail(); return { next, result: undefined };
        });
        sessionFor("recover"); return Object.freeze({ restored: preparations.length });
      },
      async recoverNotes({displayCache,signal}={}) {
      signal?.throwIfAborted();
      const summary=await recoverFamilyBalanceSummary({primaryInventory:await recovery(displayCache,signal),resources:balanceResources,store,
        reconcileUnsigned:args=>{signal?.throwIfAborted();return reconcileFamilyUnsignedReservations({...args,store,provider,verificationProvider,signal:controller.signal});},
        recover:async(r,confirmedAnchor)=>{
          signal?.throwIfAborted();live();const pin=r.deployment;
          let poolDelivery=balanceDeliveries.get(pin.pool);
          if(!poolDelivery){poolDelivery=createFamilyNoteDelivery({engine:noteEngine,domain:{...domain,pool:pin.pool,asset:pin.asset,poolCodehash:pin.poolCodehash,
            nativeGlueSha256:r.profiles.normal8.runtime.glue.sha256,nativeWasmSha256:r.profiles.normal8.runtime.wasm.sha256}});balanceDeliveries.set(pin.pool,poolDelivery);}
          return recoverFamilyCanonicalNotes({provider,verificationProvider,delivery:poolDelivery,wallet,deploymentBlock:pin.deploymentBlock,confirmedAnchor,displayCache,signal});
        }});
      signal?.throwIfAborted();live();return summary;
    } });
  } catch (error) { dispose(); throw error; }
}
