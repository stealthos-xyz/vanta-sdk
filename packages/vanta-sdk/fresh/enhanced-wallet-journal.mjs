/** Internal wallet journal for candidate enhanced funding. It never activates
 * a release, asks for a signature, broadcasts, or sends private note filters. */
import { gcm } from "@noble/ciphers/aes";
import { AbiCoder, Interface, getAddress, getBytes, hexlify, keccak256, toUtf8Bytes } from "ethers";
import { createFreshIndexedDbDepositStore } from "./funded-indexeddb-store.mjs";
import { recoverFamilyCanonicalNotes } from "./family-note-recovery.mjs";
import { validateFamilyNoteDomain } from "./family-note-delivery.mjs";

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MAX_AMOUNT = (1n << 120n) - 1n;
const HASH = /^0x[0-9a-f]{64}$/u, HEX = /^0x(?:[0-9a-f]{2})*$/u, ID = /^[A-Za-z0-9_-]{1,128}$/u;
const PHASES = ["prepared", "authorizing", "uncertain", "submitted", "included", "finalized", "expired-unused"];
const HEADER = "tuple(uint8 width,uint64 sourceEpoch,uint256 sourceCheckpoint,uint64 targetEpoch,uint256 targetCheckpoint," +
  "uint256 reservationCommitment,uint256 authorizationDigest,uint256 amountHash,uint256 scopeDigest,uint256 feeTermsHash," +
  "uint256 partnerRegistryRoot,uint64 authorizationEpoch,bytes32 nonce,uint64 deadline,address relayer," +
  "bytes32 nullifiersHash,bytes32 outputsHash,bytes32 envelopesHash,uint8[3] feeSlots)";
const ABI = new Interface([`function authorizeEnhanced(${HEADER} q,bytes encodedProof,bytes feeSignature)`,
  `function settlePublicBatch(${HEADER} q,bytes encodedProof,(address[] recipients,uint128[] amounts) batch,bytes feeSignature)`,
  "event EnhancedReservation(uint64 indexed index,uint256 commitment)",
  "event PublicBatchSettled(bytes32 indexed nonce,uint256 indexed batchDigest,uint8 recipients,uint128 total)"]);
const CODER = AbiCoder.defaultAbiCoder(), enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true });
const MAX_RECORD = 512 * 1024, MAX_JOURNAL = 16 * 1024 * 1024, MAX_RECORDS = 256;
const bytes = value => new Uint8Array(value).buffer;
const lowerAddress = value => getAddress(value).toLowerCase();
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export class EnhancedWalletJournalError extends Error {
  constructor(code) { super("Enhanced wallet journal rejected the operation."); this.name = "EnhancedWalletJournalError"; this.code = code; }
}
const fail = code => { throw new EnhancedWalletJournalError(code); };
function exact(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => d.get || d.set)) fail("INVALID_RECORD");
}
function array(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1 ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => d.get || d.set))
    fail("INVALID_RECORD");
  return value;
}
function hash(value) { if (typeof value !== "string" || !HASH.test(value)) fail("INVALID_RECORD"); return value; }
function field(value) { hash(value); if (BigInt(value) === 0n || BigInt(value) >= FR) fail("INVALID_RECORD"); return value; }
function identifier(value) { if (typeof value !== "string" || !ID.test(value)) fail("INVALID_RECORD"); return value; }
function amount(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,36}$/u.test(value) || BigInt(value) > MAX_AMOUNT) fail("INVALID_RECORD");
  return BigInt(value);
}
function number(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) fail("INVALID_RECORD"); return n; }
function capability(value, slot) {
  exact(value, ["schema", "safeForFunds", "familyTag", "slot", "openingHex"]);
  if (value.schema !== "vanta-enhanced-claim-capability-v1" || value.safeForFunds !== false || value.slot !== slot ||
      !HASH.test(value.familyTag) || typeof value.openingHex !== "string" || value.openingHex.length > 8192 ||
      !/^(?:[0-9a-f]{2})+$/u.test(value.openingHex)) fail("INVALID_RECORD");
}
function transaction(calldata, nullifiers, context) {
  if (typeof calldata !== "string" || !HEX.test(calldata) || calldata.length > MAX_RECORD) fail("INVALID_RECORD");
  let parsed;
  try { parsed = ABI.parseTransaction({ data: calldata, value: 0 }); } catch { fail("INVALID_RECORD"); }
  if (!["authorizeEnhanced", "settlePublicBatch"].includes(parsed?.name) || ABI.encodeFunctionData(parsed.fragment, parsed.args).toLowerCase() !== calldata)
    fail("INVALID_RECORD");
  const q = parsed.args[0], width = number(q.width), publicBatch = parsed.name === "settlePublicBatch";
  if (![8, 32].includes(width) || nullifiers.length !== width || new Set(nullifiers).size !== width ||
      q.nullifiersHash !== keccak256(CODER.encode([`uint256[${width}]`], [nullifiers])) ||
      BigInt(q.nonce) === 0n || (publicBatch ? BigInt(q.reservationCommitment) !== 0n || BigInt(q.scopeDigest) !== 0n || q.authorizationEpoch !== 0n
        : BigInt(q.reservationCommitment) === 0n) || number(q.deadline) === 0 ||
      lowerAddress(q.relayer) === context.pool || parsed.args[1] === "0x" || parsed.args[publicBatch ? 3 : 2] === "0x") fail("INVALID_RECORD");
  let totalAtomic = null;
  if (publicBatch) {
    const batch = parsed.args[2];
    if (batch.recipients.length < 2 || batch.recipients.length > 32 || batch.amounts.length !== batch.recipients.length ||
        batch.recipients.some(recipient => lowerAddress(recipient) === context.pool || BigInt(recipient) === 0n)) fail("INVALID_RECORD");
    const total = batch.amounts.reduce((sum, value) => sum + amount(value.toString()), 0n);
    if (total > MAX_AMOUNT) fail("INVALID_RECORD"); totalAtomic = total.toString();
  }
  return { width, deadline: number(q.deadline), relayer: lowerAddress(q.relayer), nonce: q.nonce,
    reservationCommitment: "0x" + BigInt(q.reservationCommitment).toString(16).padStart(64, "0"),
    authorizationDigest: "0x" + BigInt(q.authorizationDigest).toString(16).padStart(64, "0"), publicBatch, totalAtomic };
}

/** The default backend is real IndexedDB with strict readwrite durability.
 * A supplied native backend must implement the same global, encrypted-record
 * namespace atomically across all tabs/processes. Never pass a generation-
 * prefixed host store: the shared input lock deliberately spans generations.
 * claimRuntime must be the local pinned candidate runtime, not a model tool. */
export async function createEnhancedWalletJournal({ domain: rawDomain, wallet, delivery, claimRuntime,
  provider, verificationProvider, deploymentBlock, store: suppliedStore } = {}) {
  const domain = validateFamilyNoteDomain(rawDomain);
  if (!wallet || typeof wallet.privateWalletKeys !== "function" || !delivery ||
      Object.keys(domain).some(name => delivery.context?.[name] !== domain[name]) || !claimRuntime || typeof claimRuntime.inspectClaim !== "function" ||
      !provider || !verificationProvider || provider === verificationProvider || !Number.isSafeInteger(deploymentBlock) || deploymentBlock < 0 ||
      suppliedStore?.scope?.startsWith("vanta-host-v1/")) fail("INVALID_CONTEXT");
  const recipient = await delivery.walletRecipient(wallet), keys = await wallet.privateWalletKeys();
  const seed = new Uint8Array(keys.masterSeed ?? []);
  if (seed.length !== 32 || !same(recipient.masterPublicKey, "0x" + BigInt(keys.masterPublicKey).toString(16).padStart(64, "0")))
    fail("INVALID_CONTEXT");
  const scope = keccak256(CODER.encode(["string", "uint256", "bytes32", "address", "address", "bytes32"],
    ["VANTA_ENHANCED_WALLET_INPUTS_V1", domain.chainId, domain.genesisHash, domain.pool, domain.asset, recipient.masterPublicKey]));
  const namespace = "vanta-enhanced-wallet-inputs-v1/" + scope;
  let key;
  try {
    const material = await crypto.subtle.importKey("raw", bytes(seed), "HKDF", false, ["deriveBits"]);
    key = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256",
      salt: bytes(enc.encode(namespace)), info: bytes(enc.encode("encrypted-prepared-funding-v1")) }, material, 256));
  } finally { seed.fill(0); }
  const store = suppliedStore ?? await createFreshIndexedDbDepositStore();
  if (typeof store?.read !== "function" || typeof store?.transact !== "function") { key.fill(0); fail("INVALID_CONTEXT"); }
  let closed = false, revision = 0;
  const live = expected => { if (closed || (expected !== undefined && revision !== expected)) fail("LOCKED"); };
  const aad = id => enc.encode(namespace + "/" + id);
  const idOf = id => keccak256(toUtf8Bytes(identifier(id)));
  const view = record => freeze({ preparedId: record.preparedId, intentId: record.intentId, phase: record.phase,
    transactionHash: record.transactionHashes.at(-1) ?? null, blockNumber: record.anchor?.number ?? null,
    blockHash: record.anchor?.hash ?? null });
  function valid(record) {
    exact(record, ["schema", "scope", "context", "preparedId", "intentId", "intentBinding", "calldata", "calldataHash",
      "nullifiers", "inputs", "recipient", "netPayoutAtomic", "totalDebitAtomic", "capabilities", "phase", "transactionHashes", "anchor"]);
    const context = validateFamilyNoteDomain(record.context);
    if (record.schema !== "vanta-enhanced-wallet-journal-v1" || record.scope !== scope ||
        !["chainId", "genesisHash", "pool", "asset"].every(name => context[name] === domain[name]) || !PHASES.includes(record.phase)) fail("INVALID_RECORD");
    identifier(record.preparedId); identifier(record.intentId); hash(record.intentBinding); hash(record.calldataHash);
    array(record.nullifiers, 8, 32).forEach(field);
    const header = transaction(record.calldata, record.nullifiers, context);
    if (keccak256(record.calldata) !== record.calldataHash || amount(record.totalDebitAtomic) < amount(record.netPayoutAtomic) ||
        lowerAddress(record.recipient) !== record.recipient) fail("INVALID_RECORD");
    array(record.inputs, 1, record.nullifiers.length).forEach(input => {
      exact(input, ["commitment", "nullifier", "amountAtomic"]); field(input.commitment); field(input.nullifier); amount(input.amountAtomic);
      if (!record.nullifiers.includes(input.nullifier)) fail("INVALID_RECORD");
    });
    if (new Set(record.inputs.map(input => input.nullifier)).size !== record.inputs.length ||
        new Set(record.inputs.map(input => input.commitment)).size !== record.inputs.length) fail("INVALID_RECORD");
    if (record.inputs.reduce((sum, input) => sum + amount(input.amountAtomic), 0n) < amount(record.totalDebitAtomic)) fail("INVALID_RECORD");
    array(record.capabilities, header.publicBatch ? 0 : 3, header.publicBatch ? 0 : 3).forEach(capability);
    if (header.publicBatch && (record.recipient !== context.pool || record.netPayoutAtomic !== header.totalAtomic)) fail("INVALID_RECORD");
    array(record.transactionHashes, 0, 32).forEach(hash);
    if (new Set(record.transactionHashes).size !== record.transactionHashes.length) fail("INVALID_RECORD");
    if (record.anchor !== null) { exact(record.anchor, ["number", "hash"]); number(record.anchor.number); hash(record.anchor.hash); }
    if (["included", "finalized"].includes(record.phase) && (record.anchor === null || !record.transactionHashes.length) ||
        record.phase === "prepared" && record.transactionHashes.length ||
        !["included", "finalized", "expired-unused"].includes(record.phase) && record.anchor !== null) fail("INVALID_RECORD");
    return record;
  }
  function seal(record) {
    valid(record); const id = idOf(record.preparedId), nonce = crypto.getRandomValues(new Uint8Array(12)), clear = enc.encode(JSON.stringify(record));
    if (clear.length > MAX_RECORD) { clear.fill(0); fail("CAPACITY"); }
    try { return { id, nonce: hexlify(nonce), ciphertext: hexlify(gcm(key, nonce, aad(id)).encrypt(clear)) }; }
    finally { clear.fill(0); nonce.fill(0); }
  }
  function open(entry) {
    exact(entry, ["id", "nonce", "ciphertext"]); hash(entry.id);
    if (!/^0x[0-9a-f]{24}$/u.test(entry.nonce) || !HEX.test(entry.ciphertext) || entry.ciphertext.length > 2 * MAX_RECORD + 34)
      fail("INVALID_RECORD");
    let clear;
    try {
      clear = gcm(key, getBytes(entry.nonce), aad(entry.id)).decrypt(getBytes(entry.ciphertext));
      const record = valid(JSON.parse(dec.decode(clear)));
      if (idOf(record.preparedId) !== entry.id) fail("INVALID_RECORD");
      return record;
    } catch { fail("AUTHENTICATION_FAILED"); } finally { clear?.fill(0); }
  }
  function rows(entries) {
    array(entries, 0, MAX_RECORDS);
    if (entries.reduce((sum, entry) => sum + (entry?.ciphertext?.length ?? MAX_JOURNAL), 0) > 2 * MAX_JOURNAL ||
        new Set(entries.map(entry => entry?.id)).size !== entries.length) fail("CAPACITY");
    return entries.map(open);
  }
  async function update(preparedId, change) {
    live(); const started = revision, id = idOf(preparedId);
    const result = await store.transact(namespace, entries => {
      live(started); const records = rows(entries), index = entries.findIndex(entry => entry.id === id);
      if (index < 0) fail("UNKNOWN_PREPARATION");
      const record = change(records[index]), next = entries.slice(); next[index] = seal(record); rows(next);
      return { next, result: view(record) };
    });
    live(started); return result;
  }
  async function read(preparedId) {
    live(); const started = revision, records = rows(await store.read(namespace)); live(started);
    const record = records.find(row => row.preparedId === identifier(preparedId));
    if (!record) fail("UNKNOWN_PREPARATION"); return record;
  }
  async function recovery() {
    const result = await recoverFamilyCanonicalNotes({ provider, verificationProvider, delivery, wallet, deploymentBlock });
    if (!result.complete) fail("INCOMPLETE_RECOVERY");
    const [a, b] = await Promise.all([provider.getBlock(result.blockNumber), verificationProvider.getBlock(result.blockNumber)]);
    if (!a || !b || !same(a.hash, result.blockHash) || !same(b.hash, result.blockHash) || number(a.timestamp) !== number(b.timestamp))
      fail("CANONICAL_STATE_CHANGED");
    return { ...result, timestamp: number(a.timestamp) };
  }
  async function checkCapabilities(record, header) {
    if (header.publicBatch) return;
    const seen = new Set(); let total = 0n;
    // The pinned browser runtime can inspect all three in one activation
    // session. Older adapters expose only the single-capability operation.
    let summaries;
    if (typeof claimRuntime.inspectClaims === "function") {
      summaries = await claimRuntime.inspectClaims({ capabilities: record.capabilities });
      if (!Array.isArray(summaries) || summaries.length !== 3) fail("CAPABILITY_MISMATCH");
    }
    for (let slot = 0; slot < 3; slot++) {
      const result = summaries ? summaries[slot] : await claimRuntime.inspectClaim({ capability: record.capabilities[slot] });
      if (result?.schema !== "vanta-enhanced-claim-summary-v1" || result.safeForFunds !== false || result.slot !== slot ||
          !["familyTag", "pool", "asset", "genesisHash", "generationId"].every(name => same(result.domain?.[name], record.context[name])) ||
          String(result.domain.chainId) !== String(domain.chainId) || result.reservationCommitment !== header.reservationCommitment ||
          !same(result.recipient, record.recipient) || seen.has(result.nullifier)) fail("CAPABILITY_MISMATCH");
      field(result.nullifier); seen.add(result.nullifier); total += amount(result.amountAtomic);
    }
    if (total !== amount(record.netPayoutAtomic)) fail("CAPABILITY_MISMATCH");
  }
  const protect = work => async (...args) => {
    try { return await work(...args); } catch (error) {
      if (error instanceof EnhancedWalletJournalError) throw error;
      fail("UNAVAILABLE");
    }
  };
  const backupAad = enc.encode(namespace + "/portable-recovery-v1");
  return Object.freeze({
    reserve: protect(async plan => {
      live(); const started = revision;
      exact(plan, ["preparedId", "intentId", "intentBinding", "calldata", "nullifiers", "inputCommitments",
        "recipient", "netPayoutAtomic", "totalDebitAtomic", "capabilities"]);
      array(plan.nullifiers, 8, 32).forEach(field); array(plan.inputCommitments, 1, plan.nullifiers.length).forEach(field);
      array(plan.capabilities, 0, 3).forEach(capability);
      // Copy every caller-owned field before recovery or native inspection can
      // yield. The reviewed plan and the durable record must be identical even
      // if a caller reuses or mutates its input buffers during the await.
      plan = freeze({ preparedId: identifier(plan.preparedId), intentId: identifier(plan.intentId),
        intentBinding: hash(plan.intentBinding), calldata: plan.calldata, nullifiers: [...plan.nullifiers],
        inputCommitments: [...plan.inputCommitments], recipient: lowerAddress(plan.recipient),
        netPayoutAtomic: amount(plan.netPayoutAtomic).toString(), totalDebitAtomic: amount(plan.totalDebitAtomic).toString(),
        capabilities: plan.capabilities.map(item => ({ ...item })) });
      if (new Set(plan.inputCommitments).size !== plan.inputCommitments.length) fail("INVALID_RECORD");
      const header = transaction(plan.calldata, plan.nullifiers, domain), state = await recovery(); live(started);
      if (state.timestamp > header.deadline) fail("EXPIRED");
      // Derive all owned inputs from the complete recovered history and the
      // cryptographically bound nullifier list. A caller cannot omit a second
      // positive note just because its first note already covers the debit.
      const consumed = state.notes.filter(note => plan.nullifiers.includes(note.nullifier));
      if (consumed.length !== plan.inputCommitments.length || consumed.some(note =>
        note.status !== "spendable" || !plan.inputCommitments.includes(note.commitment))) fail("INPUT_UNAVAILABLE");
      const inputs = consumed.map(note => ({ commitment: note.commitment, nullifier: note.nullifier,
        amountAtomic: note.opening.amount_units }));
      const record = valid({ schema: "vanta-enhanced-wallet-journal-v1", scope, context: domain,
        preparedId: plan.preparedId, intentId: plan.intentId, intentBinding: plan.intentBinding, calldata: plan.calldata,
        calldataHash: keccak256(plan.calldata), nullifiers: [...plan.nullifiers], inputs, recipient: lowerAddress(plan.recipient),
        netPayoutAtomic: plan.netPayoutAtomic, totalDebitAtomic: plan.totalDebitAtomic,
        capabilities: JSON.parse(JSON.stringify(plan.capabilities)), phase: "prepared", transactionHashes: [], anchor: null });
      await checkCapabilities(record, header); live(started);
      const result = await store.transact(namespace, entries => {
        live(started); const existing = rows(entries);
        const repeated = existing.find(item => item.preparedId === record.preparedId || item.intentId === record.intentId);
        if (repeated) {
          if (JSON.stringify(repeated) !== JSON.stringify(record)) fail("ALREADY_PREPARED");
          return { next: entries, result: view(repeated) };
        }
        const locked = new Set(existing.filter(item => item.phase !== "expired-unused").flatMap(item => item.nullifiers));
        if (record.nullifiers.some(nullifier => locked.has(nullifier))) fail("INPUT_RESERVED");
        const next = [...entries, seal(record)]; rows(next); return { next, result: view(record) };
      });
      live(started); const persisted = await read(record.preparedId);
      if (persisted.calldataHash !== record.calldataHash || persisted.intentBinding !== record.intentBinding || persisted.phase !== "prepared")
        fail("DURABILITY_FAILED");
      return result;
    }),
    readPrivate: protect(async preparedId => freeze(await read(preparedId))),
    list: protect(async () => { live(); const started = revision, result = rows(await store.read(namespace)); live(started); return freeze(result.map(view)); }),
    arm: protect((preparedId, intentBinding) => update(preparedId, record => {
      if (Object.keys(domain).some(name => record.context[name] !== domain[name])) fail("CONTEXT_CHANGED");
      if (record.phase !== "prepared" || hash(intentBinding) !== record.intentBinding) fail("AUTHORIZATION_ALREADY_ATTEMPTED");
      return { ...record, phase: "authorizing", anchor: null };
    })),
    recordTransactionHash: protect((preparedId, transactionHash) => update(preparedId, record => {
      hash(transactionHash);
      if (!["authorizing", "uncertain", "submitted"].includes(record.phase)) fail("INVALID_TRANSITION");
      return { ...record, phase: "submitted", anchor: null,
        transactionHashes: [...new Set([...record.transactionHashes, transactionHash])] };
    })),
    closeUnsubmitted: protect((preparedId, intentBinding) => update(preparedId, record => {
      if(!["authorizing","uncertain"].includes(record.phase)||record.transactionHashes.length||
          hash(intentBinding)!==record.intentBinding)fail("INVALID_TRANSITION");
      // Only the authenticated relayer's durable refusal can close this
      // exact submission before the canonical expiry.
      return {...record,phase:"expired-unused",anchor:null};
    })),
    reconcile: protect(async preparedId => {
      live(); const started = revision, record = await read(preparedId), header = transaction(record.calldata, record.nullifiers, record.context);
      if (record.context.generationId !== domain.generationId || record.context.poolCodehash !== domain.poolCodehash) fail("CONTEXT_CHANGED");
      if(record.phase==="expired-unused"&&record.anchor===null)return view(record);
      const state = await recovery(), candidates = new Set(record.transactionHashes);
      // Canonical recovery already authenticated every consumed input and its
      // public spending transaction. Recover lost hashes from that evidence;
      // replaying all reservation/batch events adds no assurance for known inputs.
      const inputs=record.inputs.map(input=>state.notes.find(note=>note.commitment===input.commitment&&note.nullifier===input.nullifier));
      const knownInputs=inputs.every(note=>note&&['spendable','spent'].includes(note.status)&&
        (note.status!=='spent'||/^0x[0-9a-f]{64}$/u.test(note.spentTransactionHash??'')));
      if(knownInputs)for(const note of inputs)if(note.status==='spent')candidates.add(hash(note.spentTransactionHash));
      // Search the public event type, then match the blinded reservation locally.
      // The RPC never receives an input nullifier, claim key or plan identifier.
      const topic = [ABI.getEvent("EnhancedReservation").topicHash, ABI.getEvent("PublicBatchSettled").topicHash];
      for (let from = deploymentBlock; !knownInputs && from <= state.blockNumber; from += 1024) {
        const request = { address: domain.pool, fromBlock: from, toBlock: Math.min(from + 1023, state.blockNumber), topics: [topic] };
        const [a, b] = await Promise.all([provider.getLogs(request), verificationProvider.getLogs(request)]);
        const canonical = logs => logs.map(log => JSON.stringify([log.blockNumber, log.blockHash, log.transactionHash,
          log.index ?? log.logIndex, log.address, log.topics, log.data, Boolean(log.removed)])).sort();
        if (JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b))) fail("CANONICAL_STATE_CHANGED");
        for (const log of a) {
          if (log.removed || !same(log.address, domain.pool)) fail("CANONICAL_STATE_CHANGED");
          const event = ABI.parseLog(log);
          const matches = header.publicBatch ? event.name === "PublicBatchSettled" && event.args.nonce === header.nonce &&
            same("0x" + BigInt(event.args.batchDigest).toString(16).padStart(64, "0"), header.authorizationDigest) &&
            event.args.total.toString() === header.totalAtomic : event.name === "EnhancedReservation" &&
            same("0x" + BigInt(event.args.commitment).toString(16).padStart(64, "0"), header.reservationCommitment);
          if (matches)
            candidates.add(hash(log.transactionHash.toLowerCase()));
        }
      }
      let accepted = null, included = null;
      for (const txHash of candidates) {
        const [receipt, check, tx, checkTx] = await Promise.all([provider.getTransactionReceipt(txHash),
          verificationProvider.getTransactionReceipt(txHash), provider.getTransaction(txHash), verificationProvider.getTransaction(txHash)]);
        if (!receipt && !check) continue;
        if (!receipt || !check || !tx || !checkTx || number(receipt.status) !== number(check.status) ||
            receipt.blockNumber !== check.blockNumber || !same(receipt.blockHash, check.blockHash)) fail("CANONICAL_STATE_CHANGED");
        const exactTransaction=same(tx.to, domain.pool) && same(checkTx.to, domain.pool) && same(tx.from, header.relayer) && same(checkTx.from, header.relayer) &&
            BigInt(tx.chainId) === BigInt(domain.chainId) && BigInt(checkTx.chainId) === BigInt(domain.chainId) &&
            BigInt(tx.value) === 0n && BigInt(checkTx.value) === 0n &&
            keccak256(tx.data) === record.calldataHash && keccak256(checkTx.data) === record.calldataHash;
        if(!exactTransaction){
          // A different canonical spend can invalidate an old unsubmitted packet;
          // it cannot be presented as that packet's successful transaction.
          if(record.transactionHashes.includes(txHash))fail("CANONICAL_STATE_CHANGED");
          continue;
        }
        const [block, checkBlock] = await Promise.all([provider.getBlock(receipt.blockNumber), verificationProvider.getBlock(receipt.blockNumber)]);
        if (!block || !checkBlock || !same(block.hash, receipt.blockHash) || !same(checkBlock.hash, receipt.blockHash)) continue;
        if (number(receipt.status) !== 1) continue;
        const found = { transactionHash: txHash, number: receipt.blockNumber, hash: receipt.blockHash.toLowerCase() };
        if (receipt.blockNumber > state.blockNumber) included = found;
        else {
          if (accepted && accepted.transactionHash !== txHash) fail("CANONICAL_STATE_CHANGED");
          if (record.inputs.some(input => !state.notes.some(note => note.commitment === input.commitment &&
              note.nullifier === input.nullifier && note.status === "spent"))) fail("CANONICAL_STATE_CHANGED");
          accepted = found;
        }
      }
      const unused = record.inputs.every(input => state.notes.some(note => note.commitment === input.commitment &&
        note.nullifier === input.nullifier && note.status === "spendable"));
      const [anchor, checkAnchor] = await Promise.all([provider.getBlock(state.blockNumber), verificationProvider.getBlock(state.blockNumber)]);
      if (!same(anchor?.hash, state.blockHash) || !same(checkAnchor?.hash, state.blockHash)) fail("CANONICAL_STATE_CHANGED");
      live(started);
      return update(preparedId, current => {
        if (current.calldataHash !== record.calldataHash || current.intentBinding !== record.intentBinding ||
            JSON.stringify(current.transactionHashes) !== JSON.stringify(record.transactionHashes)) fail("CONCURRENT_UPDATE");
        const found = accepted ?? included;
        if (found) return { ...current, phase: accepted ? "finalized" : "included",
          transactionHashes: [...new Set([...current.transactionHashes, found.transactionHash])],
          anchor: { number: found.number, hash: found.hash } };
        if (state.timestamp > header.deadline && (unused || knownInputs)) return { ...current, phase: "expired-unused",
          anchor: { number: state.blockNumber, hash: state.blockHash } };
        return { ...current, phase: current.phase === "prepared" ? "prepared" : "uncertain", anchor: null };
      });
    }),
    /** Trusted local backup UI only. The existing privacy phrase derives this
     * encryption key; no new password or signing prompt is introduced. */
    exportRecoveryBackup: protect(async (attachments = null) => {
      live(); const started = revision, entries = await store.read(namespace); rows(entries); live(started);
      const clear = enc.encode(JSON.stringify({ schema: "vanta-enhanced-private-recovery-v1", scope, entries, attachments }));
      if (clear.length > MAX_JOURNAL) { clear.fill(0); fail("CAPACITY"); }
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      try { return freeze({ schema: "vanta-enhanced-encrypted-recovery-v1", scope, nonce: hexlify(nonce),
        ciphertext: hexlify(gcm(key, nonce, backupAad).encrypt(clear)) }); }
      finally { clear.fill(0); nonce.fill(0); }
    }),
    importRecoveryBackup: protect(async backup => {
      live(); const started = revision;
      exact(backup, ["schema", "scope", "nonce", "ciphertext"]);
      if (backup.schema !== "vanta-enhanced-encrypted-recovery-v1" || backup.scope !== scope ||
          !/^0x[0-9a-f]{24}$/u.test(backup.nonce) || !HEX.test(backup.ciphertext) || backup.ciphertext.length > 2 * MAX_JOURNAL + 34)
        fail("INVALID_RECORD");
      let clear, content;
      try {
        clear = gcm(key, getBytes(backup.nonce), backupAad).decrypt(getBytes(backup.ciphertext));
        content = JSON.parse(dec.decode(clear));
      } catch { fail("AUTHENTICATION_FAILED"); } finally { clear?.fill(0); }
      exact(content, ["schema", "scope", "entries", "attachments"]);
      if (content.schema !== "vanta-enhanced-private-recovery-v1" || content.scope !== scope) fail("INVALID_RECORD");
      const restored = rows(content.entries);
      for (const record of restored) await checkCapabilities(record, transaction(record.calldata, record.nullifiers, record.context));
      live(started);
      await store.transact(namespace, entries => {
        live(started); const existing = rows(entries), next = entries.slice();
        for (const restoredRecord of restored) {
          const current = existing.find(record => record.preparedId === restoredRecord.preparedId);
          if (current) {
            if (current.calldataHash !== restoredRecord.calldataHash || current.intentBinding !== restoredRecord.intentBinding ||
                current.intentId !== restoredRecord.intentId) fail("BACKUP_CONFLICT");
            continue;
          }
          const active = existing.filter(record => record.phase !== "expired-unused");
          if (active.some(record => record.intentId === restoredRecord.intentId ||
              record.nullifiers.some(value => restoredRecord.nullifiers.includes(value)))) fail("INPUT_RESERVED");
          // A portable snapshot never grants a new authorization. Settlement
          // and expiration must be reconstructed from canonical chain history.
          const record = { ...restoredRecord, phase: "uncertain", anchor: null };
          next.push(seal(record)); existing.push(record);
        }
        rows(next); return { next, result: undefined };
      });
      live(started); return content.attachments;
    }),
    close() { if (closed) return; closed = true; revision++; key.fill(0); if (!suppliedStore) store.close(); },
  });
}
