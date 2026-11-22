/** Shared local payout-intent planning for human and headless agent callers.
 * This module does not quote fees, authorize spending, create proofs, persist
 * reservations, submit transactions, or prove settlement. Its context must
 * come from the host's independently verified family/network release. Format
 * validation here is not a replacement for that runtime verification.
 * Keep planned totals local; never send this object as a signed/on-chain quote.
 */
import {getAddress} from "ethers";

const MAX_AMOUNT=(1n<<120n)-1n;
const MAX_TIME=(1n<<64n)-1n;
const MAX_CHAIN=(1n<<53n)-1n;
const ID=/^[A-Za-z0-9_-]{1,128}$/u;
const DECIMAL=/^[1-9][0-9]*$/u;
const WORD=/^0x[0-9a-fA-F]{64}$/u;
const ZERO_ADDRESS="0x0000000000000000000000000000000000000000";
const ERROR_CODES=["INVALID_ARGUMENT","UNSUPPORTED_OPERATION","NOT_READY"];
const freeze=value=>{
  if(value&&typeof value==="object"){
    for(const item of Object.values(value))freeze(item);
    Object.freeze(value);
  }
  return value;
};
const fail=code=>{throw new VantaPayoutIntentError(code);};
const exact=(value,names)=>{
  if(!value||typeof value!=="object"||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value))||
      Reflect.ownKeys(value).length!==names.length||
      names.some(name=>!Object.hasOwn(value,name)))fail("INVALID_ARGUMENT");
};
const positive=(value,max)=>{
  if(typeof value!=="string"||value.length>max.toString().length||
      !DECIMAL.test(value))fail("INVALID_ARGUMENT");
  const parsed=BigInt(value);
  if(parsed>max)fail("INVALID_ARGUMENT");
  return parsed;
};
const address=(value,allowZero=false)=>{
  let normalized;
  try{normalized=getAddress(value);}catch{fail("INVALID_ARGUMENT");}
  if(!allowZero&&normalized===ZERO_ADDRESS)fail("INVALID_ARGUMENT");
  return normalized;
};
function contextOf(raw){
  exact(raw,["networkId","generationId","pool","assetAddress"]);
  if(typeof raw.networkId!=="string"||
      !/^eip155:[1-9][0-9]{0,15}$/u.test(raw.networkId))
    fail("INVALID_ARGUMENT");
  positive(raw.networkId.slice(7),MAX_CHAIN);
  if(typeof raw.generationId!=="string"||!WORD.test(raw.generationId)||
      BigInt(raw.generationId)===0n)fail("INVALID_ARGUMENT");
  return freeze({networkId:raw.networkId,
    generationId:raw.generationId.toLowerCase(),pool:address(raw.pool),
    assetAddress:address(raw.assetAddress,true)});
}

/** Fixed public error codes only. Never copy input, witness or host errors. */
export class VantaPayoutIntentError extends Error {
  constructor(code){
    super("Vanta payout intent rejected.");
    this.name="VantaPayoutIntentError";
    this.code=ERROR_CODES.includes(code)?code:"INVALID_ARGUMENT";
  }
}

const CAPABILITIES=freeze({schema:"vanta-fresh-payout-capabilities-v1",
  planningReady:true,executionReady:false,settlementReady:false,
  x402SettlementReady:false,reason:"PAYOUT_RUNTIME_UNQUALIFIED",
  amountSemantics:"net-public-payout-atomic",
  scheduledWithdrawal:{operation:"scheduled-withdrawal",recipients:1,
    claims:3,execution:"delayed"},
  publicBatch:{operation:"public-batch",minimumRecipients:2,
    maximumRecipients:32,execution:"immediate"}});

export function getFreshPayoutCapabilities(){return CAPABILITIES;}

/** No feature flag, supplied executor or relayer response may bypass this.
 * Replace only alongside qualified shared proof, custody and receipt paths.
 */
export function assertFreshPayoutExecutionReady(){fail("NOT_READY");}

/** An intent is a local request, NOT a prepared spend or a signed fee quote.
 * Amounts are exact net public payouts; fee/gas arithmetic is deliberately
 * deferred to the canonical quote path. No individual claim secrets or times
 * are chosen here. Three randomized claims belong in the trusted wallet.
 */
export function prepareFreshPayoutIntent(rawContext,input){
  const context=contextOf(rawContext);
  if(!input||typeof input!=="object")fail("INVALID_ARGUMENT");
  const operation=input.operation;
  if(operation!=="scheduled-withdrawal"&&operation!=="public-batch")
    fail("UNSUPPORTED_OPERATION");
  exact(input,operation==="public-batch"
    ?["operation","requestId","payees"]
    :["operation","requestId","recipient","netPayoutAtomic",
      "windowStart","windowEnd"]);
  if(typeof input.requestId!=="string"||!ID.test(input.requestId))
    fail("INVALID_ARGUMENT");
  const base={schema:"vanta-fresh-payout-intent-v1",operation,
    requestId:input.requestId,...context,status:"planned",
    authorization:"none",executionReady:false,settled:false,
    feesQuoted:false,amountSemantics:"net-public-payout-atomic"};
  if(operation==="scheduled-withdrawal"){
    const recipient=address(input.recipient);
    const net=positive(input.netPayoutAtomic,MAX_AMOUNT);
    const start=positive(input.windowStart,MAX_TIME);
    const end=positive(input.windowEnd,MAX_TIME);
    if(recipient===context.pool||net<3n||end-start<2n)
      fail("INVALID_ARGUMENT");
    return freeze({...base,recipient,netPayoutAtomic:net.toString(),
      claimCount:3,windowStart:start.toString(),windowEnd:end.toString()});
  }
  if(!Array.isArray(input.payees)||input.payees.length<2||
      input.payees.length>32||
      Reflect.ownKeys(input.payees).length!==input.payees.length+1)
    fail("INVALID_ARGUMENT");
  let total=0n;
  const seen=new Set();
  const payees=[];
  for(let i=0;i<input.payees.length;i++){
    if(!Object.hasOwn(input.payees,String(i)))fail("INVALID_ARGUMENT");
    const item=input.payees[i];
    exact(item,["recipient","amountAtomic"]);
    const recipient=address(item.recipient);
    const amount=positive(item.amountAtomic,MAX_AMOUNT);
    if(recipient===context.pool||seen.has(recipient))fail("INVALID_ARGUMENT");
    seen.add(recipient);
    total+=amount;
    if(total>MAX_AMOUNT)fail("INVALID_ARGUMENT");
    payees.push({recipient,amountAtomic:amount.toString()});
  }
  return freeze({...base,payees,netPayoutAtomic:total.toString()});
}

const string={type:"string"};
const amountSchema={type:"string",pattern:"^[1-9][0-9]{0,36}$"};
const timeSchema={type:"string",pattern:"^[1-9][0-9]{0,19}$"};
const requestIdSchema={type:"string",pattern:ID.source,maxLength:128};
const objectSchema=properties=>({type:"object",properties,
  required:Object.keys(properties),additionalProperties:false});
const TOOLS=freeze([
  {name:"payout.capabilities",description:
    "Read payout planning support. Execution and settlement are not yet available.",
  inputSchema:objectSchema({})},
  {name:"payout.intent.prepare",description:
    "Validate a local net-payout request only. Does not authorize, quote fees, reserve funds or pay.",
  inputSchema:{type:"object",oneOf:[
    objectSchema({operation:{const:"scheduled-withdrawal"},
      requestId:requestIdSchema,recipient:string,
      netPayoutAtomic:amountSchema,windowStart:timeSchema,windowEnd:timeSchema}),
    objectSchema({operation:{const:"public-batch"},requestId:requestIdSchema,
      payees:{type:"array",minItems:2,maxItems:32,items:
        objectSchema({recipient:string,amountAtomic:amountSchema})}}),
  ]}},
]);

/** Transport-neutral MCP-shaped tools, reusing the exact wallet validator.
 * Context is selected by the trusted host, never the model. No browser, secret,
 * arbitrary transaction, execution callback or new authorization flow exists.
 */
export function createFreshAgentPayoutTools(rawContext){
  const context=contextOf(rawContext);
  return Object.freeze({tools:TOOLS,async invoke(name,input){
    try{
      let result;
      if(name==="payout.capabilities"){
        exact(input,[]);result=getFreshPayoutCapabilities();
      }else if(name==="payout.intent.prepare"){
        result=prepareFreshPayoutIntent(context,input);
      }else if(["payout.execute","payout.reconcile"].includes(name)){
        assertFreshPayoutExecutionReady();
      }else{fail("UNSUPPORTED_OPERATION");}
      return freeze({isError:false,
        content:[{type:"text",text:JSON.stringify(result)}]});
    }catch(error){
      const code=error instanceof VantaPayoutIntentError&&
        ERROR_CODES.includes(error.code)
        ?error.code:"INVALID_ARGUMENT";
      return freeze({isError:true,content:[{type:"text",text:JSON.stringify({
        status:"rejected",code,retryable:false})}]});
    }
  }});
}
