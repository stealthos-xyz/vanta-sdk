/** Encrypted, local balance presentation. No spend openings or lock decisions
 * are restored from storage. The caller binds the namespace to the unlocked
 * private identity within the account, network and generation store. */
import {createLiveFamilyHistoryReader} from './family-shared-history.mjs';
const WORD = /^0x[0-9a-f]{64}$/u;
const UNITS = /^(?:0|[1-9][0-9]{0,77})$/u;
const validAnchor = row => Number.isSafeInteger(row?.blockNumber) && row.blockNumber >= 0 &&
  typeof row.blockHash === 'string' && WORD.test(row.blockHash);

export function createFamilyBalanceCache({store, identity, generationId, pools, liveHistory=false}) {
  const readSharedCheckpoint=liveHistory?createLiveFamilyHistoryReader():undefined;
  const namespace = 'family-balance-display-v1/'+identity;
  const assets = new Map(pools.map(pool=>[pool.pool,pool]));
  const validSnapshot = record => {
    if (!validAnchor(record) || record.generationId !== generationId || !Array.isArray(record.pools) ||
        record.pools.length !== assets.size || new Set(record.pools.map(row=>row?.pool)).size !== assets.size)
      return false;
    return record.pools.every(row=>{
      const pin = assets.get(row?.pool);
      return pin && row.asset === pin.asset && row.assetDecimals === pin.assetDecimals &&
        typeof row.displayBalanceUnits === 'string' && UNITS.test(row.displayBalanceUnits);
    });
  };
  return Object.freeze({
    ...(readSharedCheckpoint?{readSharedCheckpoint}:{}),
    async readSnapshot() {
      const rows = await store.read(namespace);
      return rows.length === 1 && validSnapshot(rows[0]) ? rows[0] : null;
    },
    async saveSnapshot(summary) {
      if(summary.complete===false)return;
      const {generationId,blockNumber,blockHash} = summary;
      const pools = summary.pools.map(row=>{
        const pin = assets.get(row.pool);
        return {pool:row.pool, asset:pin?.asset, assetDecimals:row.assetDecimals,
          displayBalanceUnits:row.projectedBalanceUnits??row.unreservedBalanceUnits??'0'};
      });
      const record = {generationId,blockNumber,blockHash,pools};
      if (!validSnapshot(record)) return;
      await store.transact(namespace,rows=>({
        next:rows[0]?.blockNumber>blockNumber?rows:[record],result:null,
      }));
    },
    async readCheckpoint(pool) {
      if (!assets.has(pool)) return null;
      const rows = await store.read('family-balance-events-v1/'+identity+'/'+pool);
      return rows.length === 1 ? rows[0] : null;
    },
    async saveCheckpoint(pool, checkpoint, discardedAnchor) {
      if (!assets.has(pool)) return;
      await store.transact('family-balance-events-v1/'+identity+'/'+pool,rows=>{
        const old=rows[0]?.anchor;
        const discarded=discardedAnchor && old?.number===discardedAnchor.number && old.hash===discardedAnchor.hash;
        return {next:old?.number>checkpoint.anchor.number&&!discarded?rows:[checkpoint],result:null};
      });
    },
  });
}
