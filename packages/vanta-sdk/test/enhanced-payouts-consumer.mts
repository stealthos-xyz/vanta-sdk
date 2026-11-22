import { createEnhancedPayoutSchedule, projectVerifiedEnhancedPayoutStatus,
  type EnhancedPayoutContext, type VerifiedEnhancedClaimReceipt }
  from "../fresh/enhanced-payouts.mjs";

const schedule = createEnhancedPayoutSchedule({ netPayoutAtomic: "123456789" },
  { maximumWindowEpochs: 360 });
const context: EnhancedPayoutContext = { networkId: "eip155:6281971",
  generationId: "0x" + "11".repeat(32), pool: "0x" + "22".repeat(20),
  assetAddress: "0x" + "00".repeat(20) };
const claims = schedule.claims.map((claim, index) => ({
  nullifier: "0x" + (index + 1).toString(16).padStart(64, "0"),
  recipient: "0x" + "33".repeat(20), amountAtomic: claim.amountAtomic }));
const receipt: VerifiedEnhancedClaimReceipt = { ...context, ...claims[0],
  transactionHash: "0x" + "44".repeat(32), blockNumber: 1,
  blockHash: "0x" + "55".repeat(32), canonicalBlockHash: "0x" + "55".repeat(32),
  finalizedBlockNumber: 1 };
const progress: string = projectVerifiedEnhancedPayoutStatus({ context, claims,
  observations: [{ nullifier: claims[0].nullifier, state: "finalized", receipt }] }).progress;
void progress;
