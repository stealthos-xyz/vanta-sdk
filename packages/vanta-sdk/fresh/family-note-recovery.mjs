import {getConfirmedBlock,getSharedConfirmedBlock} from './transaction-confirmations.mjs';
import {readSharedFamilyHistory} from './family-shared-history.mjs';
import {canonicalFamilyProvider,readFamilyLogWindow} from './family-rpc.mjs';
/** Internal family recovery from the complete canonical public event stream.
 * No private commitment/nullifier filters, fee amounts, wallet keys or opening
 * data are sent to RPC. Results describe one finalized block, not a spend grant. */
import { Interface, getAddress, getBytes, keccak256 } from "ethers";
import { FamilyNoteDeliveryError, validateFamilyNoteDomain } from "./family-note-delivery.mjs";

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const RESERVED_ROWS = 32, MAX_ROWS = 65536;
// Memory-only checkpoints. Every reuse reobserves the saved canonical block;
// new blocks are replayed and a reorg discards the checkpoint entirely.
const publicCheckpoints = new WeakMap(), decryptedNotes = new WeakMap(), displayNotes = new WeakMap();
const ABI = new Interface([
  "function releaseSetupId() view returns(bytes32)", "function releaseGenerationId() view returns(bytes32)",
  "function releaseFamilyTag() view returns(bytes32)", "function releaseChainId() view returns(uint256)",
  "function releaseGenesisHash() view returns(bytes32)", "function asset() view returns(address)",
  "function activeGeneration() view returns(uint64 id,uint64 rows,uint256 checkpoint)",
  "function sourceSnapshot(uint64 id) view returns(uint64 rows,uint256 x,uint256 y,uint256 checkpoint,bool closed)",
  "event CanonicalKzgRow(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment)",
  "event CanonicalEncryptedNote(uint64 indexed epoch,uint64 indexed row,uint256 indexed commitment,bytes32 envelopeHash,bytes encryptedEnvelope)",
  "event NullifierConsumed(uint256 indexed nullifier,uint8 indexed width)",
]);
const EVENTS = ["CanonicalKzgRow", "CanonicalEncryptedNote", "NullifierConsumed"];
const TOPICS = EVENTS.map(name => ABI.getEvent(name).topicHash);
const fail = () => { throw new FamilyNoteDeliveryError("CANONICAL_STATE_REJECTED"); };
const hash = value => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) fail();
  return value.toLowerCase();
};
const field = value => { if (typeof value !== "bigint" || value <= 0n || value >= FR) fail(); return "0x" + value.toString(16).padStart(64, "0"); };
const integer = value => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) fail(); return result; };
const address = value => { try { return getAddress(value).toLowerCase(); } catch { fail(); } };
const block = raw => { if (!raw) fail(); return { number: integer(raw.number), hash: hash(raw.hash) }; };
const frozen = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
};
const logIdentity = log => JSON.stringify([integer(log.blockNumber), hash(log.blockHash), hash(log.transactionHash),
  integer(log.index ?? log.logIndex), address(log.address), log.topics.map(hash), log.data.toLowerCase(), log.removed === true]);

// Retry only explicit provider range limits; compare both sources for the
// same reduced window before advancing the canonical scan cursor.
async function readCanonicalLogWindow(provider, verificationProvider, address, topics, fromBlock, anchorBlock, chunkBlocks) {
  const {toBlock,chunkBlocks:next,value}=await readFamilyLogWindow({fromBlock,anchorBlock,chunkBlocks,read:async(fromBlock,toBlock)=>{
    const filter={address,fromBlock,toBlock,topics};
    const logs=await provider.getLogs(filter);
    const other=verificationProvider?await verificationProvider.getLogs(filter):undefined;
    return {logs,other};
  }});
  return {toBlock,chunkBlocks:next,...value};
}

const WORD = /^0x[0-9a-f]{64}$/u;
function readDisplayCheckpoint(record, scope, deploymentBlock, verificationProvider) {
  if (record?.scope !== scope || !Number.isSafeInteger(record.anchor?.number) ||
      record.anchor.number < deploymentBlock || !WORD.test(record.anchor.hash) ||
      !Array.isArray(record.nextRows) || !Array.isArray(record.encryptedRows) ||
      !Array.isArray(record.spentTransactions) || record.nextRows.length < 1 ||
      record.nextRows.some(rows => !Number.isSafeInteger(rows) || rows < RESERVED_ROWS || rows > MAX_ROWS)) return undefined;
  const next = record.nextRows.map(()=>RESERVED_ROWS);
  for (const row of record.encryptedRows) {
    if (!Number.isSafeInteger(row?.epoch) || row.epoch < 0 || row.epoch >= next.length ||
        row.row !== next[row.epoch]++ || row.row >= MAX_ROWS ||
        !Number.isSafeInteger(row.blockNumber) || row.blockNumber < deploymentBlock || row.blockNumber > record.anchor.number ||
        !WORD.test(row.blockHash) || !WORD.test(row.transactionHash) || !WORD.test(row.commitment) ||
        !WORD.test(row.envelopeHash) || typeof row.envelope !== 'string' ||
        row.envelope.length < 130 || row.envelope.length > 4098 || !/^0x01(?:[0-9a-f]{2})+$/u.test(row.envelope) ||
        keccak256(row.envelope) !== row.envelopeHash)
      return undefined;
  }
  if (!next.every((rows,epoch)=>rows===record.nextRows[epoch])) return undefined;
  const spentTransactions = new Map();
  for (const pair of record.spentTransactions) {
    if (!Array.isArray(pair) || pair.length!==2 || !pair.every(value=>typeof value==='string'&&WORD.test(value)) ||
        spentTransactions.has(pair[0])) return undefined;
    spentTransactions.set(...pair);
  }
  return {...record,verificationProvider,spentTransactions,spentNullifiers:new Set(spentTransactions.keys()),displayOnly:true};
}

/** Presentation derived only from locally decrypted, canonical notes. Exclude
 * outputs of our own spends (change), but retain incoming notes after spending.
 * No opening, viewing key or nullifier crosses the wallet-worker boundary. */
export function summarizeFamilyReceivedTransactions(notes) {
  const outgoing = new Set(notes.flatMap(note => note.spentTransactionHash ? [hash(note.spentTransactionHash)] : []));
  const received = new Map();
  for (const note of notes) {
    const transactionHash = hash(note.transactionHash), value = BigInt(note.opening.amount_units);
    if (note.status === 'nonspendable' || value <= 0n || outgoing.has(transactionHash)) continue;
    const previous = received.get(transactionHash);
    if (previous && previous.blockNumber !== note.blockNumber) fail();
    const memo = previous?.memo ?? note.memo;
    received.set(transactionHash, {transactionHash, blockNumber: integer(note.blockNumber),
      amountAtomic: (BigInt(previous?.amountAtomic ?? '0') + value).toString(), ...(memo ? {memo} : {})});
  }
  return frozen([...received.values()]);
}

export async function recoverFamilyCanonicalNotes({ provider, verificationProvider, delivery, wallet, deploymentBlock, chunkBlocks = 1000, confirmedAnchor, displayCache, useSharedHistory = true, signal }) {
  const checkAbort=()=>signal?.throwIfAborted();checkAbort();
  if (!provider || !delivery || typeof delivery.decrypt !== "function" || typeof delivery.walletRecipient !== "function") fail();
  const context = validateFamilyNoteDomain(delivery.context);
  // Reject a locked or internally inconsistent wallet before distinguishing
  // another sender's invalid delivery from a legitimate local opening.
  const recipient = await delivery.walletRecipient(wallet);
  provider = canonicalFamilyProvider(provider);
  if (verificationProvider) {
    verificationProvider = canonicalFamilyProvider(verificationProvider);
    if (verificationProvider === provider) verificationProvider = undefined;
  }
  deploymentBlock = integer(deploymentBlock);
  if (!Number.isSafeInteger(chunkBlocks) || chunkBlocks < 1 || chunkBlocks > 10000) fail();
  // A portfolio may recover several pools at one already-confirmed block.
  // pin() still verifies its canonical hash and confirmation depth on each RPC.
  const anchor = block(confirmedAnchor ?? await (verificationProvider ? getSharedConfirmedBlock(provider, verificationProvider) : getConfirmedBlock(provider)));
  if (anchor.number < deploymentBlock) fail();
  let checkpoints = publicCheckpoints.get(provider);
  if (!checkpoints) { checkpoints = new Map(); publicCheckpoints.set(provider, checkpoints); }
  const scope = JSON.stringify([context, deploymentBlock, !!verificationProvider]);
  const sources = verificationProvider ? [provider, verificationProvider] : [provider];
  const matchesAnchor = async target => {
    const observed = await Promise.all(sources.map(source => source.getBlock(target.number)));
    return observed.every(value => value?.number === target.number && value.hash?.toLowerCase() === target.hash);
  };
  const usable = async candidate => candidate && candidate.verificationProvider === verificationProvider &&
    candidate.anchor.number <= anchor.number && await matchesAnchor(candidate.anchor);
  let previous = checkpoints.get(scope), discardedAnchor;
  if (!await usable(previous)) previous = undefined;
  if (displayCache) {
    const legacyScope=JSON.stringify([context,deploymentBlock,true]);
    const displayRecord=record=>readDisplayCheckpoint(!verificationProvider&&record?.scope===legacyScope?{...record,scope}:record,scope,deploymentBlock,verificationProvider);
    const saved = await displayCache.readCheckpoint(context.pool).catch(()=>null);
    const local = displayRecord(saved);
    if (local && (!previous || local.anchor.number > previous.anchor.number)) {
      if (await usable(local)) previous = local;
      else discardedAnchor = local.anchor;
    }
    // The shared historical checkpoint is distributed inside the signed SDK
    // and is used only for display. Spending still obtains its own complete
    // canonical inventory; no shared cursor enters that cache.
    if (useSharedHistory) {
      const latest=displayRecord(await displayCache.readSharedCheckpoint?.(context,deploymentBlock,previous?.anchor.number));
      checkAbort();
      if(latest&&(!previous||latest.anchor.number>previous.anchor.number)&&await usable(latest))previous=latest;
      const shared = displayRecord(await readSharedFamilyHistory(context, deploymentBlock, previous?.anchor.number));
      if (shared && (!previous || shared.anchor.number > previous.anchor.number) && await usable(shared)) previous = shared;
    }
  }
  const read = async (name, args = []) => {
    checkAbort();
    const request = { to: context.pool, data: ABI.encodeFunctionData(name, args), blockTag: anchor.number };
    const data = await provider.call(request);
    if (verificationProvider && (await verificationProvider.call(request)).toLowerCase() !== data.toLowerCase()) fail();
    checkAbort();return ABI.decodeFunctionResult(name, data);
  };
  async function pin(source) {
    checkAbort();
    const [network, genesis, anchored, finalized, code] = await Promise.all([
      source.getNetwork(), source.getBlock(0), source.getBlock(anchor.number), getConfirmedBlock(source), source.getCode(context.pool, anchor.number),
    ]);
    checkAbort();
    if (BigInt(network.chainId) !== BigInt(context.chainId) || block(genesis).hash !== context.genesisHash ||
        block(anchored).hash !== anchor.hash || block(finalized).number < anchor.number ||
        code === "0x" || keccak256(code) !== context.poolCodehash) fail();
  }
  await pin(provider); if (verificationProvider) await pin(verificationProvider);
  await Promise.all([["releaseSetupId", context.setupId], ["releaseGenerationId", context.generationId],
    ["releaseFamilyTag", context.familyTag], ["releaseChainId", BigInt(context.chainId)],
    ["releaseGenesisHash", context.genesisHash], ["asset", context.asset]].map(async ([name, expected]) => {
    const [raw] = await read(name), actual = typeof raw === "string" ? raw.toLowerCase() : raw;
    if (actual !== expected) fail();
  }));
  const active = await read("activeGeneration"), activeEpoch = integer(active[0]), epochs = [];
  for (let epoch = 0; epoch <= activeEpoch; epoch++) {
    const snapshot = await read("sourceSnapshot", [epoch]), rows = integer(snapshot[0]);
    if (rows < RESERVED_ROWS || rows > MAX_ROWS || snapshot[3] <= 0n || snapshot[3] >= FR || snapshot[4] !== (epoch < activeEpoch)) fail();
    epochs.push({ epoch, rows, checkpoint: field(snapshot[3]), x: snapshot[1].toString(), y: snapshot[2].toString(), closed: snapshot[4] });
  }
  if (epochs[activeEpoch].rows !== integer(active[1]) || epochs[activeEpoch].checkpoint !== field(active[2])) fail();
  if (previous?.displayOnly && previous.nextRows.some((rows,epoch)=>!epochs[epoch] || rows>epochs[epoch].rows)) {
    discardedAnchor = previous.anchor;
    previous = undefined;
  }
  const nextRows = epochs.map((_,i) => previous?.nextRows[i] ?? RESERVED_ROWS), encryptedRows = previous ? previous.encryptedRows.slice() : [],
    spentNullifiers = new Set(previous?.spentNullifiers), spentTransactions = new Map(previous?.spentTransactions);
  let pending, previousBlock = -1, previousIndex = -1;
  let persistedThrough = previous?.anchor.number ?? deploymentBlock - 1;
  const saveDisplayProgress = async through => {
    if (!displayCache) return;
    const blocks = await Promise.all(sources.map(source => source.getBlock(through)));
    const at = block(blocks[0]);
    if (at.number !== through || blocks.some(value => value?.number !== through || value.hash?.toLowerCase() !== at.hash) ||
        !await matchesAnchor(anchor)) fail();
    const record = {scope, anchor: at, nextRows: nextRows.slice(), encryptedRows: encryptedRows.slice(),
      spentTransactions: [...spentTransactions]};
    await displayCache.saveCheckpoint(context.pool, record, discardedAnchor).catch(()=>{});
    persistedThrough = through;
  };
  for (let fromBlock = previous ? previous.anchor.number + 1 : deploymentBlock; fromBlock <= anchor.number;) {
    checkAbort();
    const window = await readCanonicalLogWindow(provider, verificationProvider, context.pool, [TOPICS], fromBlock, anchor.number, chunkBlocks);
    checkAbort();
    const { toBlock, logs, other } = window;
    chunkBlocks = window.chunkBlocks;
    if (verificationProvider && (other.length !== logs.length || logs.some((log, index) => logIdentity(log) !== logIdentity(other[index])))) fail();
    const numbers = [...new Set(logs.map(log => integer(log.blockNumber)))];
    const blocks = new Map(await Promise.all(numbers.map(async number => [number, block(await provider.getBlock(number))])));
    for (const log of logs) {
      checkAbort();
      const number = integer(log.blockNumber), index = integer(log.index ?? log.logIndex);
      if (log.removed || address(log.address) !== context.pool || number < fromBlock || number > toBlock ||
          hash(log.blockHash) !== blocks.get(number).hash || number < previousBlock || (number === previousBlock && index <= previousIndex)) fail();
      previousBlock = number; previousIndex = index;
      const parsed = ABI.parseLog(log); if (!parsed || !EVENTS.includes(parsed.name)) fail();
      const args = parsed.args;
      if (parsed.name === "NullifierConsumed") {
        const nullifier = field(args.nullifier);
        if (pending || ![8n, 32n].includes(args.width) || spentNullifiers.has(nullifier)) fail();
        spentNullifiers.add(nullifier); spentTransactions.set(nullifier, hash(log.transactionHash)); continue;
      }
      const epoch = integer(args.epoch), row = integer(args.row), commitment = field(args.commitment), transactionHash = hash(log.transactionHash);
      if (epoch > activeEpoch || row < RESERVED_ROWS || row >= epochs[epoch].rows) fail();
      if (parsed.name === "CanonicalKzgRow") {
        if (pending || row !== nextRows[epoch]) fail();
        pending = { epoch, row, commitment, transactionHash, blockNumber: number, blockHash: hash(log.blockHash), logIndex: index };
      } else {
        if (!pending || pending.epoch !== epoch || pending.row !== row || pending.commitment !== commitment ||
            pending.transactionHash !== transactionHash || pending.blockNumber !== number || pending.logIndex >= index) fail();
        const envelope = args.encryptedEnvelope.toLowerCase(), bytes = getBytes(envelope), envelopeHash = hash(args.envelopeHash);
        // The custody contract admits a bounded versioned envelope. A future
        // or malformed delivery cannot erase other valid owned notes below.
        if (bytes.length < 64 || bytes.length > 2048 || bytes[0] !== 1 || keccak256(envelope) !== envelopeHash) fail();
        encryptedRows.push({ ...pending, envelope, envelopeHash }); nextRows[epoch]++; pending = undefined;
      }
    }
    if (pending) fail();
    // Save only complete, ordered event windows at a verified
    // canonical anchor. An interrupted sync resumes from its last safe window.
    if (displayCache && toBlock - persistedThrough >= 8000)
      await saveDisplayProgress(toBlock);
    fromBlock = toBlock + 1;
  }
  if (nextRows.some((count, epoch) => count !== epochs[epoch].rows)) fail();
  const notes = [], seenNullifiers = new Set(), quarantined = [];
  const noteCache = previous?.displayOnly ? displayNotes : decryptedNotes;
  let walletCache = noteCache.get(wallet);
  if (!walletCache) { walletCache = new Map(); noteCache.set(wallet, walletCache); }
  const privateScope = JSON.stringify([scope, recipient]);
  let openings = walletCache.get(privateScope);
  if (!openings) { openings = new Map(); if(walletCache.size >= 8)walletCache.clear(); walletCache.set(privateScope, openings); }
  for (const row of encryptedRows) {
    checkAbort();
    let owned;
    const key = JSON.stringify([row.blockHash,row.transactionHash,row.row,row.commitment,row.envelopeHash]);
    try {
      if(openings.has(key))owned=openings.get(key);
      else { owned = await delivery.decrypt({ wallet, envelope: row.envelope, commitment: row.commitment }); openings.set(key,frozen(owned)); }
    }
    catch (error) {
      if (!(error instanceof FamilyNoteDeliveryError)) throw error;
      // Encryption authenticates bytes to a public receiving key, not an
      // honest sender. A sender can deliberately encrypt an invalid opening.
      quarantined.push({ epoch: row.epoch, row: row.row, commitment: row.commitment,
        transactionHash: row.transactionHash, reason: "INVALID_DELIVERY" }); continue;
    }
    if (owned === null) continue;
    if (owned.verification.commitment !== row.commitment || owned.note.commitment !== row.commitment) fail();
    if (!owned.verification.nonspendable && seenNullifiers.has(owned.verification.nullifier)) {
      quarantined.push({ epoch: row.epoch, row: row.row, commitment: row.commitment,
        transactionHash: row.transactionHash, reason: "DUPLICATE_SPEND_AUTHORITY" }); continue;
    }
    if (!owned.verification.nonspendable) seenNullifiers.add(owned.verification.nullifier);
    const status = owned.verification.nonspendable ? "nonspendable"
      : spentNullifiers.has(owned.verification.nullifier) ? "spent" : "spendable";
    notes.push({ epoch: row.epoch, row: row.row, transactionHash: row.transactionHash, blockNumber: row.blockNumber,
      commitment: row.commitment, envelopeHash: row.envelopeHash, opening: owned.note,
      nullifier: owned.verification.nullifier, status, ...(owned.memo ? {memo:owned.memo} : {}),
      ...(status === 'spent' ? {spentTransactionHash: spentTransactions.get(owned.verification.nullifier)} : {}) });
  }
  // A reorg during local decryption invalidates the complete inventory. A newer
  // finalized descendant is allowed; the returned block explicitly fixes scope.
  await pin(provider); if (verificationProvider) await pin(verificationProvider);
  checkAbort();
  const saved = checkpoints.get(scope);
  // A durable display cursor can never populate the funded in-memory cursor.
  // Funded actions keep their separate canonical recovery.
  if(!previous?.displayOnly && (!saved || saved.anchor.number <= anchor.number)) {
    if(checkpoints.size >= 32 && !checkpoints.has(scope))checkpoints.clear();
    checkpoints.set(scope,{anchor,verificationProvider,nextRows:nextRows.slice(),encryptedRows:encryptedRows.slice(),
      spentNullifiers:new Set(spentNullifiers),spentTransactions:new Map(spentTransactions)});
  }
  if (displayCache && quarantined.length===0 && (!previous?.displayOnly || previous.anchor.hash!==anchor.hash)) {
    await displayCache.saveCheckpoint(context.pool,{
      scope,anchor,nextRows,encryptedRows,spentTransactions:[...spentTransactions],
    },discardedAnchor).catch(()=>{});
  }
  const verifiedSpendableAtomic = notes.filter(note => note.status === "spendable")
    .reduce((sum, note) => sum + BigInt(note.opening.amount_units), 0n).toString();
  return frozen({ schema: "vanta-family-canonical-note-recovery-v1", safeForFunds: false, ceremonyReady: false,
    context, blockNumber: anchor.number, blockHash: anchor.hash, deploymentBlock,
    ...(previous?.displayOnly ? {resumedDisplayCheckpoint:true} : {}), complete: quarantined.length === 0,
    verifiedEmpty: quarantined.length === 0 && encryptedRows.length === 0, publicRows: encryptedRows.length,
    publicCommitments:encryptedRows.map(({epoch,row,commitment})=>({epoch,row,commitment})),epochs, notes, quarantined,
    receivedTransactions: summarizeFamilyReceivedTransactions(notes),
    verifiedSpendableAtomic, balanceAtomicAtAnchor: quarantined.length === 0 ? verifiedSpendableAtomic : null });
}
