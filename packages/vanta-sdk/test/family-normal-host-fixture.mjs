// Lifecycle-only fixtures; synthetic RPC responses are never proof acceptance.
import {ZeroAddress,keccak256} from 'ethers';
import {familyNormalAbi as ABI,familyNormalDigest} from '../fresh/family-normal-wire.mjs';
import {familyRoutedAbi as ROUTED,familyRouteHash} from '../fresh/family-routed-wire.mjs';
import {createVantaHostAtomicStore} from '../fresh/host-storage.mjs';
export const W=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),A=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
export let state;
import{familyTotalSpendAmounts}from'../fresh/family-operation-review.mjs';
export{assertFamilyReviewedFees}from'../fresh/family-operation-review.mjs';
export async function quoteFamilyOperationFees(input){
 const feeRules={protocolBps:15,protocolMinimum:'0',partnerBps:20,partnerMinimum:'0',partnerMaximum:((1n<<120n)-1n).toString()};
 const amounts=familyTotalSpendAmounts({...input,feeRules});
 return{...amounts,grossAmountAtomic:input.amountAtomic,feeRules,pool:state.resources.deployment.pool,asset:state.resources.deployment.asset,generationId:state.resources.generationId,deadline:Math.floor(Date.now()/1000)+300};
}
export async function prepareFamilyOperationFeeReview(){await state.beforeFeeReview?.();return quoteFamilyOperationFees;}
export async function prepareFamilyNetRoute(){await state.beforeRouteReview?.();return amountAtomic=>quoteFamilyNetRoute({amountAtomic});}
export async function quoteFamilyNetRoute(input){state.routeAmount=input.amountAtomic;return{amountOutAtomic:(BigInt(input.amountAtomic)*2n).toString(),minimumOutputAtomic:(BigInt(input.amountAtomic)*2n).toString(),maximumDeliveryFeeAtomic:'0',outputDecimals:6};}
export const getCompiledFamilyEvmRelease=()=>state.release;
export const getCompiledVantaFamilyProofResources=()=>({funding:state.funding});
export const validateVantaFamilyFundingResources=f=>f;
export const verifyCompiledFamilyEvmRuntime=async()=>{};
export const verifyCompiledFamilyOperationRuntime=async()=>{};
export const isFamilyWithdrawalOnlyContext=()=>state.historical;
export const createVantaFamilyProofRuntime=async()=>({async warmDepositRuntime(){state.warmFee=(state.warmFee??0)+1;},dispose(){}});
export const createVantaFamilyPartnerRegistry=async()=>({dispose(){}});
export const createVantaEnhancedFundingRuntime=async()=>({resources:state.resources,async warm({width}={}){state.warmNormal=(state.warmNormal??0)+1;(state.warmWidths??=[]).push(width);},noteEngine:async()=>({}),dispose(){}});
export const createFamilyNoteDelivery=()=>({});
export const recoverFamilyCanonicalNotes=async()=>{if(state.inventory)return state.inventory;throw Error('No proving in lifecycle fixtures');};
const empty=p=>p.baseType==='array'?Array.from({length:p.arrayLength<0?0:p.arrayLength},()=>empty(p.arrayChildren)):
 p.baseType==='tuple'?Object.fromEntries(p.components.map(c=>[c.name,empty(c)])):p.type==='address'?ZeroAddress:p.type==='bytes'?'0x':p.type.startsWith('bytes')?W(0):0n;
export function setup(operation=1){
 const memory=new Map(),pool=operation===5?A(3):A(1),asset=operation===5?A(103):ZeroAddress;
 state={operation,head:20,time:1000,hash:W(600),blockHash:W(500),submissions:0,used:false,spent:false,receipts:new Map(),transactions:new Map(),logs:[],
  routes:{gateway:{address:A(50)},nativePool:A(1),usdcPool:A(2),bnmPool:A(3),usdc:A(102),bnm:A(103),maximumDeliveryFee:'30',destination:{chainId:11155111}},
  resources:{chainId:6281971,familyTag:W(7),genesisHash:W(3),generationId:W(8),deployment:{setupId:W(9),pool,asset,poolCodehash:W(10),assetSymbol:'FIX',assetDecimals:18,deploymentBlock:5},
   profiles:{normal8:{runtime:{glue:{sha256:'01'.repeat(32)},wasm:{sha256:'02'.repeat(32)}}}}}};
 state.funding={routes:state.routes};state.release={lock:{contracts:[]},pins:{networkId:'eip155:6281971',generationId:W(8)}};
 const store=createVantaHostAtomicStore({host:{capabilities:{localOnly:true,encryptedAtRest:true,durableAtomicCompareAndSwap:true},
  async read(k){return structuredClone(memory.get(k)??{revision:'0',entries:[]});},
  async compareAndSwap({namespace,expectedRevision,entries}){const old=memory.get(namespace)??{revision:'0',entries:[]};
   if(old.revision!==expectedRevision)return {committed:false,revision:old.revision};const revision=String(Number(old.revision)+1);
   memory.set(namespace,{revision,entries:structuredClone(entries)});return {committed:true,revision};}},
  scope:{accountId:'fixture',address:A(4),networkId:'eip155:6281971',generationId:W(8)}});
 const provider=()=>({async getBlock(tag){return {number:typeof tag==='number'?tag:state.head,hash:state.blockHash,timestamp:state.time};},
  async call(tx){if(tx.to===A(50)){const p=ROUTED.parseTransaction(tx);if(p.name==='predictEscrow')return ROUTED.encodeFunctionResult(p.name,[A(60)]);return '0x';}
   const p=ABI.parseTransaction(tx);if(p.name==='usedNonce')return ABI.encodeFunctionResult(p.name,[state.used]);
   if(p.name==='nullifierSpent')return ABI.encodeFunctionResult(p.name,[state.spent]);return '0x';},
  async getTransaction(h){return state.transactions.get(h)??null;},async getTransactionReceipt(h){return state.receipts.get(h)??null;},async getLogs(){return state.logs;}});
 const wallet={},options={operation,store,provider:provider(),verificationProvider:provider(),walletController:{requireWallet:()=>wallet},
  relayerUrl:'https://example.invalid/',walletAddress:A(4),approvePrivateSend:async()=>{await state.beforeApproval?.();return true;},
  approveRoute:async()=>{await state.beforeApproval?.();return true;},submitTransaction:async()=>{throw Error('Customer EOA must never submit an outward operation');},
  fetcher:async(url,init)=>{const operation=new URL(url).pathname.split('/').at(-1),body=JSON.parse(init.body);
   if(operation==='gas'){await state.beforeGasQuote?.();state.gasQuotes=(state.gasQuotes??0)+1;return Response.json({schema:'stealthos-family-relay-gas-v1',pool:state.resources.deployment.pool,asset:state.resources.deployment.asset,generationId:state.resources.generationId,operation:state.operation,width:body.width,relayWallet:A(44),gasReserveAtomic:state.gasReserve,token:'fixture',expiresAt:Math.floor(Date.now()/1000)+600});}
   if(operation==='submit'){state.submissions++;state.submitted={from:A(44),to:[4,5].includes(state.operation)?A(50):state.resources.deployment.pool,value:state.operation===5?'2':'0',data:body.calldata};await state.beforeSubmit?.();return Response.json({transactionHash:state.hash});}
   if(operation==='status')return Response.json({transactionHash:state.submissions?state.hash:null});throw Error('Unexpected lifecycle request');}};
 return {options,store,namespace:(operation===0?'family-public-withdrawals-v1':operation===1?'family-private-sends-v1':'family-routed-v1/'+operation)+'/'+pool};
}
export function row(){
 const op=state.operation,d=state.resources.deployment,routed=[4,5].includes(op),q={chainId:6281971,pool:d.pool,asset:d.asset,width:8,mode:op,sourceEpoch:0,sourceCheckpoint:'30',targetEpoch:0,targetCheckpoint:'30',
  recipient:op!==1?A(60):ZeroAddress,payout:op!==1?'100':'0',protocolFeeCap:'5',partnerFeeCap:'0',relayerFeeCap:'7',protocolRecipient:A(5),partnerRecipient:ZeroAddress,relayer:routed?A(50):A(44),
  nullifiersHash:W(70),outputsHash:W(71),envelopesHash:W(72),saltedAmountHash:'66',feeSlotsHash:W(73),feeTermsHash:'74',partnerRegistryRoot:'75',nonce:W(76),deadline:2000,feePolicyHash:W(77)},
  route={operation:op,sourcePool:d.pool,sourceAsset:d.asset,payer:A(44),receiver:A(6),amount:'100',minimumOutput:'100',deadline:2000,nonce:q.nonce,maximumDeliveryFee:op===5?'2':'0'},
  proof=empty(ABI.getFunction('settleNormalEpoch8').inputs[1]),calldata=routed?ROUTED.encodeFunctionData('execute8',[q,proof,'0x',route]):ABI.encodeFunctionData('settleNormalEpoch8',[q,proof,'0x']);
 return {schema:'stealthos-family-private-send-v2',id:'send_'+W(1).slice(2),pool:d.pool,generationId:W(8),relayWallet:A(44),prequoteToken:'fixture',phase:'prepared',q,...(routed?{route}:{}),
  nullifiers:[W(101)],anchorBlock:10,...(op===5?{destinationAnchor:{number:10,hash:W(500)}}:{}),calldata,calldataHash:keccak256(calldata),review:{recipient:routed?A(6):{},operation:op,amountAtomic:'100',gasReserveAtomic:'7',deadline:2000}};
}
export function recordSuccess(item){
 state.used=true;state.spent=true;
 const event=ABI.encodeEventLog(ABI.getEvent('PreAuditNormalSettlement'),[item.q.nonce,0,0,8,item.q.mode,item.q.payout,30]);
 state.logs=[{address:item.pool,blockNumber:15,blockHash:state.blockHash,transactionHash:state.hash,removed:false,...event}];
 const logs=item.route?[{address:A(50),...ROUTED.encodeEventLog(ROUTED.getEvent('RoutedSettlement'),[item.q.nonce,familyRouteHash(A(50),item.route),item.pool,
  item.q.mode,A(6),100,100,item.q.mode===5?W(999):W(0),item.q.mode===5?1:0])}]:[];
 state.transactions.set(state.hash,{hash:state.hash,chainId:6281971n,to:item.route?A(50):item.pool,from:A(44),value:item.q.mode===5?2n:0n,data:item.calldata});
 state.receipts.set(state.hash,{blockNumber:15,blockHash:state.blockHash,status:1,logs});
}

export {normalizeFamilyPrivateMemo,FAMILY_PRIVATE_MEMO_MAX_BYTES} from "../fresh/family-note-delivery.mjs";
