import {getConfirmedBlock} from './transaction-confirmations.mjs';
import {canonicalFamilyProvider,readFamilyLogWindow} from './family-rpc.mjs';
/** Funding reconciliation belongs to the existing encrypted wallet journal.
 * This adds canonical independent claim observations without private filters. */
import { enhancedAddress as address, enhancedField as field, enhancedFail as fail,
  enhancedPoolAbi as ABI, enhancedSame as same, enhancedWord as word } from "./family-enhanced-wire.mjs";

export const pendingEnhancedStatus = (failed = false) => ({ completed: 0, total: 3, progress: "0/3", authorized: false,
  authorizationFailed: failed, recoveryRequired: !failed,
  claims: [1, 2, 3].map(number => ({ number, state: "waiting", transactionHash: null })) });
const blockOf = raw => {
  if (!raw || !Number.isSafeInteger(raw.number) || raw.number < 0 || !Number.isSafeInteger(raw.timestamp)) fail();
  return { number: raw.number, hash: word(raw.hash?.toLowerCase()), timestamp: raw.timestamp };
};
const identity = log => [log.blockNumber, log.blockHash?.toLowerCase(), log.transactionHash?.toLowerCase(),
  log.index ?? log.logIndex, address(log.address), log.topics.map(t => t.toLowerCase()), log.data.toLowerCase(), Boolean(log.removed)];

const claimCheckpoints=new WeakMap();
export async function readEnhancedClaimLogs({provider,second,domain,fromBlock,anchor}){
 provider=canonicalFamilyProvider(provider);second=canonicalFamilyProvider(second);
 let scopes=claimCheckpoints.get(provider);if(!scopes){scopes=new Map();claimCheckpoints.set(provider,scopes);}
 const key=JSON.stringify(domain),saved=scopes.get(key),topic=ABI.getEvent('EnhancedClaimSettled').topicHash;
 let previous=saved&&saved.second===second&&saved.fromBlock<=fromBlock&&saved.anchor.number<=anchor.number?saved:null;
 const bothBlock=async number=>{const a=blockOf(await provider.getBlock(number)),b=second===provider?a:blockOf(await second.getBlock(number));if(a.hash!==b.hash)fail();return a;};
 if(previous&&(await bothBlock(previous.anchor.number)).hash!==previous.anchor.hash)previous=null;
 const logs=previous?previous.logs.slice():[],begin=previous?previous.anchor.number+1:fromBlock;
 let chunkBlocks=1000;
 for(let from=begin;from<=anchor.number;){
  const window=await readFamilyLogWindow({fromBlock:from,anchorBlock:anchor.number,chunkBlocks,read:async(fromBlock,toBlock)=>{
   const filter={address:domain.pool,fromBlock,toBlock,topics:[topic]},left=await provider.getLogs(filter),right=second===provider?left:await second.getLogs(filter);
   return [left,right];
  }});
  chunkBlocks=window.chunkBlocks;const [left,right]=window.value;
  if(!same(left.map(identity),right.map(identity)))fail();
  for(const log of left){if(log.removed||log.blockNumber<from||log.blockNumber>window.toBlock||address(log.address)!==domain.pool||
    word(log.blockHash.toLowerCase())!==(await bothBlock(log.blockNumber)).hash)fail();logs.push(log);}
  from=window.toBlock+1;
 }
 if((await bothBlock(anchor.number)).hash!==anchor.hash)fail();
 if(scopes.size>=8&&!scopes.has(key))scopes.delete(scopes.keys().next().value);
 scopes.set(key,{second,fromBlock:previous?.fromBlock??fromBlock,anchor:{...anchor},logs});
 return logs.filter(log=>log.blockNumber>=fromBlock);
}

async function reconcileFunding({ record, relay, journal }) {
  if (record.phase === "failed" && !record.journalArmed &&
      ["before-submission","expired-unsigned","cancelled"].includes(record.failure)) return { phase: "expired-unused", transactionHash: null };
  if (!record.journalArmed) return null;
  const saved = await journal.readPrivate(record.preparedId);
  if (["authorizing", "uncertain", "submitted"].includes(saved.phase)) {
    const attempt = await relay.submissionStatus({ requestId: record.requestId });
    if (attempt.transactionHash !== null && !saved.transactionHashes.includes(word(attempt.transactionHash)))
      await journal.recordTransactionHash(record.preparedId, attempt.transactionHash);
  }
  return journal.reconcile(record.preparedId);
}
export async function reconcilePublicBatchPlan(options) {
  const funding = await reconcileFunding(options);
  return { authorized: ["included", "finalized"].includes(funding?.phase), authorizationFailed: funding?.phase === "expired-unused",
    finalized: funding?.phase === "finalized", transactionHash: funding?.transactionHash ?? null };
}
export async function reconcileEnhancedPlan({ provider, verificationProvider: second, domain, record, relay, journal, deploymentBlock }) {
  if (!second || second === provider) fail();
  const funding = await reconcileFunding({ record, relay, journal });
  if (!funding) return pendingEnhancedStatus();
  if (funding.phase === "expired-unused") return {...pendingEnhancedStatus(true),
    ...(record.failure==="inputs-reserved"?{failure:"inputs-reserved"}:
      record.failure==="before-submission"?{failure:"before-submission"}:{})};
  if (!["included", "finalized"].includes(funding.phase)) return pendingEnhancedStatus();
  const [latestA, latestB, finalA, finalB] = await Promise.all([
    provider.getBlock("latest"), second.getBlock("latest"), getConfirmedBlock(provider), getConfirmedBlock(second),
  ]);
  const latest = Math.min(blockOf(latestA).number, blockOf(latestB).number);
  const finalized = Math.min(blockOf(finalA).number, blockOf(finalB).number);
  if (finalized > latest || finalized < deploymentBlock) fail();
  const anchor = blockOf(await provider.getBlock(latest)), final = blockOf(await provider.getBlock(finalized));
  if (blockOf(await second.getBlock(latest)).hash !== anchor.hash || blockOf(await second.getBlock(finalized)).hash !== final.hash ||
      blockOf(await provider.getBlock(funding.blockNumber)).hash !== funding.blockHash ||
      blockOf(await second.getBlock(funding.blockNumber)).hash !== funding.blockHash) fail();
  const settled = [];
    for (const log of await readEnhancedClaimLogs({provider,second,domain,fromBlock:Math.max(deploymentBlock,funding.blockNumber),anchor})) {
      const parsed = ABI.parseLog(log);
      if (parsed?.name !== "EnhancedClaimSettled") fail();
      settled.push({ ...log, args: parsed.args });
  }
  const claims = record.plan.claims.map(({ summary }, i) => {
    const matches = settled.filter(log => field(log.args.nullifier) === summary.nullifier);
    if (matches.length > 1) fail();
    if (matches.length) {
      const log = matches[0];
      if (address(log.args.recipient) !== address(summary.recipient) || log.args.amount.toString() !== summary.amountAtomic) fail();
      return { number: i + 1, state: log.blockNumber <= finalized ? "finalized" : "included", transactionHash: word(log.transactionHash.toLowerCase()) };
    }
    return { number: i + 1, state: BigInt(Math.floor(anchor.timestamp / 60)) > BigInt(summary.windowEnd) ? "recovery" : "waiting", transactionHash: null };
  });
  if (blockOf(await provider.getBlock(latest)).hash !== anchor.hash || blockOf(await second.getBlock(latest)).hash !== anchor.hash) fail();
  const completed = claims.filter(v => v.state === "finalized").length;
  return { completed, total: 3, progress: `${completed}/3`, authorized: true, authorizationFailed: false,
    recoveryRequired: claims.some(v => v.state === "recovery"), claims };
}
