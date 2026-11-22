export type FreshPayoutContext=Readonly<{
  /** From independently verified host release pins, never model arguments. */
  networkId:`eip155:${string}`;generationId:string;
  pool:string;assetAddress:string;
}>;
export type FreshScheduledPayoutRequest=Readonly<{
  operation:"scheduled-withdrawal";requestId:string;recipient:string;
  /** Net public payout in atomic asset units, not gross debit or a float. */
  netPayoutAtomic:string;
  /** Canonical positive unsigned 64-bit Unix seconds. */
  windowStart:string;windowEnd:string;
}>;
export type FreshPublicBatchRequest=Readonly<{
  operation:"public-batch";requestId:string;
  payees:readonly Readonly<{recipient:string;amountAtomic:string}>[];
}>;
type FreshPayoutIntentBase=FreshPayoutContext&Readonly<{
  schema:"vanta-fresh-payout-intent-v1";requestId:string;
  status:"planned";authorization:"none";executionReady:false;
  settled:false;feesQuoted:false;
  amountSemantics:"net-public-payout-atomic";netPayoutAtomic:string;
}>;
export type FreshPayoutIntent=FreshPayoutIntentBase&(
  Readonly<{operation:"scheduled-withdrawal";recipient:string;
    claimCount:3;windowStart:string;windowEnd:string}>|
  Readonly<{operation:"public-batch";
    payees:readonly Readonly<{recipient:string;amountAtomic:string}>[]}>);
export type FreshPayoutCapabilities=Readonly<{
  schema:"vanta-fresh-payout-capabilities-v1";
  planningReady:true;executionReady:false;settlementReady:false;
  x402SettlementReady:false;reason:"PAYOUT_RUNTIME_UNQUALIFIED";
  amountSemantics:"net-public-payout-atomic";
  scheduledWithdrawal:Readonly<{operation:"scheduled-withdrawal";
    recipients:1;claims:3;execution:"delayed"}>;
  publicBatch:Readonly<{operation:"public-batch";minimumRecipients:2;
    maximumRecipients:32;execution:"immediate"}>;
}>;
export class VantaPayoutIntentError extends Error {
  readonly code:"INVALID_ARGUMENT"|"UNSUPPORTED_OPERATION"|"NOT_READY";
  constructor(code:"INVALID_ARGUMENT"|"UNSUPPORTED_OPERATION"|"NOT_READY");
}
export function getFreshPayoutCapabilities():FreshPayoutCapabilities;
/** Always throws NOT_READY until shared funded execution is qualified. */
export function assertFreshPayoutExecutionReady():never;
/** Local planning only. Must not be sent as a public or signed fee quote. */
export function prepareFreshPayoutIntent(context:FreshPayoutContext,
  input:FreshScheduledPayoutRequest|FreshPublicBatchRequest):FreshPayoutIntent;
export function createFreshAgentPayoutTools(context:FreshPayoutContext):Readonly<{
  tools:readonly Readonly<{name:"payout.capabilities"|"payout.intent.prepare";
    description:string;inputSchema:Readonly<Record<string,unknown>>}>[];
  invoke(name:string,input:unknown):Promise<Readonly<{isError:boolean;
    content:readonly Readonly<{type:"text";text:string}>[]}>>;
}>;
