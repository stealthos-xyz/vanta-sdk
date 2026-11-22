import {getConfirmedBlock} from './transaction-confirmations.mjs';
import {createVantaFamilyPartnerAssetSignup} from './family-partner-asset-signup.mjs';
/** Private, account-scoped DogeOS partner signup journal. The trusted caller
 * supplies the already-verified compiled family registry and unlocked wallets.
 * Only public EVM transaction fields cross to the selected EOA wallet. */
const SCHEMA = "vanta-family-partner-signup-v1";
const NAME = "family-partner-signup-v1";
const HASH = /^0x[0-9a-f]{64}$/iu;
const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const HEX = /^0x(?:[0-9a-f]{2})+$/iu;
const AMOUNT = /^(0|[1-9][0-9]{0,36})$/u;
const fail = message => { throw Error(`Family partner signup: ${message}`); };
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

function checkedFees(value) {
  if (!Array.isArray(value) || value.length !== 6) fail("six operation fees required");
  return Object.freeze(value.map((fee, operation) => {
    const { feeBps, minimumFee, maximumFee } = fee ?? {};
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000 ||
        typeof minimumFee !== "bigint" || typeof maximumFee !== "bigint" ||
        minimumFee < 0n || maximumFee < minimumFee || maximumFee >= 1n << 120n ||
        (feeBps === 0 ? minimumFee !== maximumFee : maximumFee === 0n))
      fail("invalid fee policy bounds");
    return Object.freeze({ feeBps, minimumFee, maximumFee });
  }));
}
const toStoredFees = fees => fees.map(fee => ({ feeBps: fee.feeBps,
  minimumFee: fee.minimumFee.toString(), maximumFee: fee.maximumFee.toString() }));
function fromStoredFees(raw) {
  if (!Array.isArray(raw) || raw.length !== 6 || raw.some(fee =>
    !fee || typeof fee.minimumFee !== "string" || !AMOUNT.test(fee.minimumFee) ||
    typeof fee.maximumFee !== "string" || !AMOUNT.test(fee.maximumFee))) fail("invalid pending fees");
  return checkedFees(raw.map(fee => ({ feeBps: fee.feeBps,
    minimumFee: BigInt(fee.minimumFee), maximumFee: BigInt(fee.maximumFee) })));
}
function requestOf(raw, registry) {
  if (!raw || Object.keys(raw).sort().join() !== "calldata,chainId,maxGasLimit,registrar,settlementNonce" ||
      raw.chainId !== registry.chainId || !ADDRESS.test(raw.registrar) || !HEX.test(raw.calldata) ||
      raw.calldata.length > 512 * 1024 || !HASH.test(raw.settlementNonce) ||
      !/^[1-9][0-9]{0,7}$/u.test(raw.maxGasLimit) ||
      BigInt(raw.maxGasLimit) > 9_500_000n) fail("request differs from the compiled family transaction");
  return Object.freeze({ ...raw });
}
function pendingOf(rows, registry) {
  if (!Array.isArray(rows) || rows.length > 1) fail("invalid encrypted journal");
  if (!rows.length) return null;
  const record = rows[0];
  if (!record || Object.keys(record).sort().join() !==
      "fees,from,generationId,handle,kind,request,schema,serializedIntent,transactionHash" ||
      record.schema !== SCHEMA || record.generationId !== registry.generationId ||
      !["handle", "registration"].includes(record.kind) ||
      typeof record.handle !== "string" || !/^[a-z0-9][a-z0-9.-]{1,63}$/u.test(record.handle) ||
      !ADDRESS.test(record.from) || record.from !== record.from.toLowerCase() ||
      (record.transactionHash !== null && (!HASH.test(record.transactionHash) ||
        BigInt(record.transactionHash) === 0n)) ||
      (record.kind === "handle" ? record.serializedIntent !== null :
        typeof record.serializedIntent !== "string" || record.serializedIntent.length > 2 * 1024 * 1024))
    fail("invalid encrypted pending operation");
  fromStoredFees(record.fees);
  requestOf(record.request, registry);
  if (record.kind === "registration") {
    const intent = registry.restorePending(record.serializedIntent);
    if (intent.kind !== "register" || !same(intent.request.calldata, record.request.calldata) ||
        !same(intent.request.registrar, record.request.registrar) ||
        !same(intent.request.settlementNonce, record.request.settlementNonce))
      fail("pending registration differs from owner-authorized KZG calldata");
  }
  return record;
}
const publicStatus = record => record ? Object.freeze({ stage: record.kind,
  handle: record.handle, status: record.transactionHash ? "submitted" : "broadcast-uncertain",
  transactionHash: record.transactionHash }) : Object.freeze({ status: "none" });

/** No caller-controlled release, proof verifier, fee sponsor, destination or
 * operator override. This coordinator does not hold an EVM/private key. */
export function createVantaFamilyPartnerSignup({ registry, wallet, hostWallet, store,
  provider, verificationProvider,onProgress } = {}) {
  if(registry?.assetRegistrationVersion===3)return createVantaFamilyPartnerAssetSignup({registry,wallet,hostWallet,store,provider,verificationProvider,onProgress});
  if (!registry || !Number.isSafeInteger(registry.chainId) || registry.chainId < 1 ||
      !HASH.test(registry.generationId ?? "") ||
      ["prepareHandleClaim", "prepareRegistration", "verifyReceipt", "serializePending", "restorePending"]
        .some(name => typeof registry[name] !== "function") ||
      !wallet || typeof wallet.prepareFamilyPartnerHandleClaim !== "function" ||
      !hostWallet || typeof hostWallet.getContext !== "function" ||
      typeof hostWallet.sendTransaction !== "function" ||
      !store || typeof store.read !== "function" || typeof store.transact !== "function" ||
      typeof store.scope !== "string" ||
      !store.scope.endsWith(`/eip155:${registry.chainId}/${registry.generationId}`) ||
      !provider || !verificationProvider || provider === verificationProvider ||
      [provider, verificationProvider].some(value =>
        ["getTransaction", "getTransactionReceipt", "getBlock"].some(name => typeof value[name] !== "function")))
    fail("compiled registry, two independent RPCs and encrypted wallet journal required");
  let busy = false;
  const read = async () => pendingOf(await store.read(NAME), registry);
  const write = async (previous, next) => store.transact(NAME, rows => {
    const current = pendingOf(rows, registry);
    if (JSON.stringify(current) !== JSON.stringify(previous)) fail("concurrent partner signup changed");
    return { next: next ? [next] : [], result: undefined };
  });
  const account = async () => {
    const context = await hostWallet.getContext();
    if (context.chainId !== registry.chainId || !ADDRESS.test(context.address) ||
        context.networkId !== `eip155:${registry.chainId}`) fail("connected wallet or chain changed");
    return context;
  };
  const make = ({ kind, handle, fees, request, from, serializedIntent = null }) => ({
    schema: SCHEMA, kind, handle, fees: toStoredFees(fees),
    generationId: registry.generationId, request: requestOf(request, registry),
    from: from.toLowerCase(), serializedIntent, transactionHash: null,
  });
  async function submit(record, context) {
    const tx = { from: context.address, to: record.request.registrar,
      chainId: `0x${registry.chainId.toString(16)}`, value: "0x0",
      data: record.request.calldata,
      gas: `0x${BigInt(record.request.maxGasLimit).toString(16)}` };
    // The journal is committed before the wallet prompt. An ambiguous wallet
    // response is never retried automatically, even after process restart.
    try {
      await hostWallet.sendTransaction({ transaction: tx, context,
        onSubmitted: async hash => {
          if (!HASH.test(hash) || BigInt(hash) === 0n) fail("invalid wallet transaction hash");
          const latest = await read();
          if (!latest || latest.transactionHash !== null || latest.kind !== record.kind ||
              latest.from !== record.from ||
              latest.request.settlementNonce !== record.request.settlementNonce)
            fail("pending wallet approval changed");
          await write(latest, { ...latest, transactionHash: hash.toLowerCase() });
        } });
    } catch (error) {
      if (error?.code === "HOST_USER_REJECTED") {
        const latest = await read();
        if (latest && latest.transactionHash === null && latest.kind === record.kind &&
            latest.from === record.from &&
            latest.request.settlementNonce === record.request.settlementNonce) await write(latest, null);
      }
      throw error;
    }
    return await read();
  }
  async function receipt(record) {
    const hash = record.transactionHash;
    if (!hash) fail("broadcast outcome uncertain, reconciliation required");
    const [ta, tb, ra, rb, finalizedA, finalizedB] = await Promise.all([
      provider.getTransaction(hash), verificationProvider.getTransaction(hash),
      provider.getTransactionReceipt(hash), verificationProvider.getTransactionReceipt(hash),
      getConfirmedBlock(provider), getConfirmedBlock(verificationProvider),
    ]);
    if (!ta || !tb || !ra || !rb || ra.status !== 1 || rb.status !== 1 ||
        !same(ta.hash, hash) || !same(tb.hash, hash) ||
        BigInt(ta.chainId) !== BigInt(registry.chainId) || BigInt(tb.chainId) !== BigInt(registry.chainId) ||
        BigInt(ta.value) !== 0n || BigInt(tb.value) !== 0n ||
        !same(ta.from, record.from) || !same(tb.from, record.from) ||
        !same(ta.to, record.request.registrar) || !same(tb.to, record.request.registrar) ||
        !same(ta.data, record.request.calldata) || !same(tb.data, record.request.calldata) ||
        !same(ra.blockHash, rb.blockHash) || ra.blockNumber !== rb.blockNumber ||
        !Number.isSafeInteger(ra.blockNumber) ||
        !Number.isSafeInteger(finalizedA?.number) || !Number.isSafeInteger(finalizedB?.number) ||
        Math.min(finalizedA.number, finalizedB.number) < ra.blockNumber)
      fail("two confirmation RPCs did not agree on the exact partner transaction");
    const [ba, bb] = await Promise.all([
      provider.getBlock(ra.blockNumber), verificationProvider.getBlock(ra.blockNumber),
    ]);
    if (!same(ba?.hash, ra.blockHash) || !same(bb?.hash, ra.blockHash))
      fail("partner transaction is missing from the canonical chain");
  }
  async function settle(record) {
    await receipt(record);
    if (record.kind === "handle") {
      const current = await registry.prepareHandleClaim({ wallet, handle: record.handle });
      if (current.alreadyClaimed !== true || current.request !== null)
        fail("confirmed handle does not match the private owner claim");
    } else {
      await registry.verifyReceipt({ prepared: registry.restorePending(record.serializedIntent),
        transactionHash: record.transactionHash });
    }
    await write(record, null);
    return record.kind;
  }
  async function register(handle, fees) {
    const context = await account();
    const claimed = await registry.prepareHandleClaim({ wallet, handle });
    const normalized = claimed.claim?.handle;
    if (typeof normalized !== "string" || !/^[a-z0-9][a-z0-9.-]{1,63}$/u.test(normalized))
      fail("unrecognized private handle");
    if (!claimed.alreadyClaimed) {
      const record = make({ kind: "handle", handle: normalized, fees,
        request: claimed.request, from: context.address });
      await write(null, record);
      await submit(record, context);
      const latest = await read();
      await settle(latest);
    }
    const prepared = await registry.prepareRegistration({ wallet, claim: claimed.claim, feePolicy: fees });
    const record = make({ kind: "registration", handle: normalized, fees,
      request: prepared.request, from: context.address,
      serializedIntent: registry.serializePending(prepared) });
    await write(null, record);
    await submit(record, context);
    const latest = await read();
    await settle(latest);
    return Object.freeze({ status: "registered", handle: normalized,
      transactionHash: latest.transactionHash, generationId: registry.generationId });
  }
  async function exclusive(task) {
    if (busy) fail("another signup operation is in progress");
    busy = true;
    try { return await task(); } finally { busy = false; }
  }
  return Object.freeze({
    async pendingStatus() { return publicStatus(await read()); },
    onboardPartner({ handle, fees }) { return exclusive(async () => {
      if (await read()) fail("resume the existing pending operation first");
      return register(handle, checkedFees(fees));
    }); },
    resumePending() { return exclusive(async () => {
      const record = await read();
      if (!record) return Object.freeze({ status: "none" });
      if (!record.transactionHash) return publicStatus(record);
      const context = await account();
      if (!same(context.address, record.from)) fail("pending operation belongs to another EOA");
      await settle(record);
      if (record.kind === "registration")
        return Object.freeze({ status: "registered", handle: record.handle,
          transactionHash: record.transactionHash, generationId: registry.generationId });
      return register(record.handle, fromStoredFees(record.fees));
    }); },
  });
}
