import {createFreshAgentPayoutTools,getFreshPayoutCapabilities,
  prepareFreshPayoutIntent,type FreshPayoutContext,
  type FreshPayoutIntent} from "@stealthos/vanta-sdk/payouts";

// Compile-only consumer fixture. No release, wallet or payment is activated.
const context:FreshPayoutContext={networkId:"eip155:6281971",
  generationId:"0x"+"01".repeat(32),pool:"0x"+"01".repeat(20),
  assetAddress:"0x"+"00".repeat(20)};
const plan:FreshPayoutIntent=prepareFreshPayoutIntent(context,{
  operation:"scheduled-withdrawal",requestId:"one",recipient:"0x"+"02".repeat(20),
  netPayoutAtomic:"3",windowStart:"1",windowEnd:"3"});
const unavailable:false=plan.executionReady;
const unsettled:false=plan.settled;
const planned:"planned"=plan.status;
const caps=getFreshPayoutCapabilities();
const noX402:false=caps.x402SettlementReady;
const tools=createFreshAgentPayoutTools(context);
void tools.invoke("payout.intent.prepare",{});
void [unavailable,unsettled,planned,noX402];
if(plan.operation==="scheduled-withdrawal"){
  const three:3=plan.claimCount;
  void three;
}
// @ts-expect-error Atomic values must be decimal strings, never JS numbers.
prepareFreshPayoutIntent(context,{operation:"scheduled-withdrawal",requestId:"bad",recipient:"0x02",netPayoutAtomic:3,windowStart:"1",windowEnd:"3"});
// @ts-expect-error Model-facing plans cannot select an executor or private key.
prepareFreshPayoutIntent(context,{operation:"public-batch",requestId:"bad",payees:[],execute:()=>true});
