import { createEnhancedWithdrawalHost, createEnhancedWithdrawalAgentTools,
  type EnhancedWithdrawalHost, type EnhancedWithdrawalHostContext,
  type EnhancedWithdrawalHostRuntime, type EnhancedWithdrawalHostSession,
  type EnhancedWithdrawalStatus } from "../fresh/enhanced-host.mjs";
import { createEnhancedWithdrawalHost as rootFactory, createVantaHostAtomicStore,
  type VantaHostStorageBackend } from "../fresh/index.mjs";
import type { EnhancedWithdrawalReview } from "../fresh/enhanced-payouts.mjs";

declare const context: EnhancedWithdrawalHostContext;
declare const runtime: EnhancedWithdrawalHostRuntime;
declare const backend: VantaHostStorageBackend;
declare const session: EnhancedWithdrawalHostSession;
const store = createVantaHostAtomicStore({ host: backend, scope: {
  accountId: "local-account", address: "0x" + "11".repeat(20),
  networkId: context.networkId, generationId: context.generationId,
} });
const options = { context, runtime, store, getSession: () => session };
const host: EnhancedWithdrawalHost = createEnhancedWithdrawalHost(options);
const rootHost: EnhancedWithdrawalHost = rootFactory(options);
const review: EnhancedWithdrawalReview = await host.prepare({ amountAtomic: "9000", destination: "0x" + "22".repeat(20) });
const cancelled: {readonly cancelled: true} = await host.cancel({intentId: review.intentId});
const authorized = await host.authorize({ intentId: review.intentId });
const status: EnhancedWithdrawalStatus = await host.monitor({ transactionId: authorized.transactionId });
const history = await host.list();
const tools = createEnhancedWithdrawalAgentTools({ host, permissions: ["prepare", "monitor"] });
await tools.invoke("enhanced.monitor", { transactionId: authorized.transactionId });
// @ts-expect-error Release readiness is not a caller-configurable option.
createEnhancedWithdrawalHost({ ...options, enabled: true });
// @ts-expect-error Arbitrary EVM signing is not an enhanced host permission.
createEnhancedWithdrawalAgentTools({ host, permissions: ["signTransaction"] });
// @ts-expect-error Local-only cancellation is not delegated to MCP tools.
createEnhancedWithdrawalAgentTools({ host, permissions: ["cancel"] });
// @ts-expect-error The sole authorization accepts an intent ID, not a replacement recipient.
await host.authorize({ intentId: review.intentId, recipient: "0x" + "33".repeat(20) });
void rootHost; void status; void history; void cancelled;
