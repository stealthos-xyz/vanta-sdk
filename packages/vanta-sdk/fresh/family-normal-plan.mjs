/** Wallet-local KZG private-send plan. Openings and hidden amounts never enter
 * the fee-signer request; only the final public quote is sent for signing. */
import {ZeroAddress,keccak256,getAddress} from 'ethers';
import {depositPoseidon as H} from './family-deposit-wire.mjs';
import {enhancedField as F,enhancedRandomField as random,enhancedCoder as coder,
 enhancedHashNullifiers,enhancedHashOutputs,enhancedHashEnvelopes,ENHANCED_FIELD as FR} from './family-enhanced-wire.mjs';
import {familyNormalDigest,familyNormalBatchField,familyNormalFeeSignals,familyRoutedFeeSignals,encodeFamilyPrivateSend,encodeFamilyRoutedSpend} from './family-normal-wire.mjs';
import {isVantaEnhancedFundingRuntime} from './family-enhanced-funding-runtime.mjs';
import {familyProofFailure} from './family-deposit-errors.mjs';
const proofStep=async(step,work)=>{try{return await work();}catch(error){throw familyProofFailure(error,step);}};
const fail=()=>{throw Error('Private transfer plan does not match the authenticated wallet, fees or recipient.');};
const amount=v=>{if(typeof v!=='string'||!/^[1-9][0-9]{0,36}$/u.test(v)||BigInt(v)>=(1n<<120n))fail();return BigInt(v);};
const due=(n,bps,min,max)=>{let v=(n*BigInt(bps)+9999n)/10000n;if(v<BigInt(min))v=BigInt(min);if(v>BigInt(max))fail();return v;};
const cap=v=>{if(v===0n)return 0n;let n=1n;while(n<v)n<<=1n;if(n>=(1n<<120n))fail();return n;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sameAddress=(a,b)=>{try{return getAddress(a)===getAddress(b);}catch{return false;}};
export const prepareFamilyWithdrawalPlan=input=>prepareNormalPlan({...input,operation:0,route:undefined});
export const prepareFamilyPrivateSendPlan=input=>prepareNormalPlan({...input,operation:1,route:undefined});
export const prepareFamilyRoutedPlan=input=>{
 if(![4,5].includes(input.operation)||input.route?.operation!==input.operation||input.route?.amount!==input.amountAtomic||
  input.route?.sourcePool!==input.domain.pool||input.route?.sourceAsset!==input.domain.asset||input.route?.nonce!==input.prequote.nonce||
  input.route?.deadline!==input.prequote.deadline||input.recipient!==input.prequote.escrow||input.relayerWallet!==input.prequote.gateway)fail();
 return prepareNormalPlan(input);
};
async function prepareNormalPlan({wallet,funding,delivery,domain,selected,inventory,membership,protocolPolicy,prequote,
 recipient,amountAtomic,relayerWallet,signal,operation,route,memo}){
 const routed=operation!==1;
 signal?.throwIfAborted();if(!isVantaEnhancedFundingRuntime(funding)||membership.relation!=='combined'||membership.operation!==operation||
  !sameAddress(membership.pool,domain.pool)||!sameAddress(membership.asset,domain.asset)||Number(prequote.chainId)!==domain.chainId||
  prequote.pool!==domain.pool||prequote.asset!==domain.asset||prequote.partnerHandleId!==F(membership.basePartnerId)||
  Number(prequote.width)!==selected.width||Number(prequote.sourceEpoch)!==selected.source.epoch||
  BigInt(prequote.sourceCheckpoint)!==BigInt(selected.source.checkpoint)||protocolPolicy.policyHash!==prequote.feePolicyHash||
  !same(prequote.feeSlots,[1,2,3])||prequote.routes?.length!==3||!inventory.complete)fail();
 if(BigInt(prequote.partnerRegistryRoot)!==membership.root)fail();
 const n=amount(amountAtomic),protocol=due(n,protocolPolicy.rates[operation],prequote.minimumProtocolFee,(1n<<120n)-1n),
  partner=due(n,membership.feeBps,membership.feeMinimum,membership.feeMaximum),gas=amount(prequote.gasReserveAtomic),debit=n+protocol+partner+gas;
 if(!sameAddress(relayerWallet,[4,5].includes(operation)?prequote.gateway:operation===0&&prequote.batchGateway?prequote.batchGateway:prequote.relayWallet))fail();
 if(debit>=(1n<<120n)||debit>BigInt(selected.totalAtomic))fail();
 const change=BigInt(selected.totalAtomic)-debit,minimumChange=routed?2n:1n;
 if(change<minimumChange)throw Error('Private transfer: Insufficient unlocked balance for the payment, fees and minimum private change.');
 const firstChange=routed?change/2n:0n,lastChange=change-firstChange;
 const sender=await delivery.walletRecipient(wallet),routes=prequote.routes;
 if(routes.some(r=>r.generationId!==domain.generationId||r.pool!==domain.pool||r.asset!==domain.asset)||
  routes[1].handleId!==F(membership.basePartnerId))fail();
 const outputs=[delivery.createRecipientNote({recipient:routed?sender:recipient,amountAtomic:routed?firstChange.toString():amountAtomic}),
  delivery.createRecipientNote({recipient:routes[0].recipient,amountAtomic:protocol.toString()}),
  delivery.createRecipientNote({recipient:routes[1].recipient,amountAtomic:partner.toString()}),
  delivery.createRecipientNote({recipient:routes[2].recipient,amountAtomic:gas.toString()}),
  await delivery.createOwnedNote({wallet,amountAtomic:lastChange.toString()})];
 const receivers=[routed?sender:recipient,...routes.map(r=>r.recipient),sender],envelopes=await Promise.all(outputs.map((note,i)=>delivery.encrypt({recipient:receivers[i],note,...(i===0&&operation===1&&memo?{memo}:{})}))),
  commitments=outputs.map(n=>n.commitment),amountSalt=random(),padSeed=outputs[4].random,blinding=random();
 const q={chainId:domain.chainId,pool:domain.pool,asset:domain.asset,width:selected.width,mode:operation,sourceEpoch:selected.source.epoch,
  sourceCheckpoint:selected.source.checkpoint,targetEpoch:Number(prequote.targetEpoch),targetCheckpoint:prequote.targetCheckpoint,
  recipient:routed?recipient:ZeroAddress,payout:routed?amountAtomic:'0',protocolFeeCap:(routed?protocol:cap(protocol)).toString(),partnerFeeCap:(routed?partner:cap(partner)).toString(),relayerFeeCap:gas.toString(),
  protocolRecipient:prequote.protocolRecipient,partnerRecipient:prequote.partnerRecipient,relayer:relayerWallet,
  nullifiersHash:'0x'+'00'.repeat(32),outputsHash:enhancedHashOutputs(commitments),envelopesHash:enhancedHashEnvelopes(envelopes),
  saltedAmountHash:F(1),feeSlotsHash:keccak256(coder.encode(['uint8[3]'],[[1,2,3]])),feeTermsHash:F(1),
  partnerRegistryRoot:membership.root.toString(),nonce:prequote.nonce,deadline:Number(prequote.deadline),feePolicyHash:prequote.feePolicyHash};
 const nonce=await H(membership.partnerId,prequote.nonceSalt);if(F(nonce)!==q.nonce)fail();
 const batch=familyNormalBatchField(q);q.saltedAmountHash=F(await H(await H(0x53544f5356384841n,n,amountSalt),batch,0));
 const fields=[domain.chainId,domain.pool,delivery.tokenHash,BigInt(q.feePolicyHash)%FR,selected.width,operation,5,prequote.minimumProtocolFee,
  q.protocolFeeCap,q.partnerFeeCap,gas,...routes.map(r=>r.masterPublicKey),1,2,3,...commitments,protocol,partner,gas,blinding];
 let terms=0x5638465445520001n;for(let i=0;i<fields.length;i+=2)terms=await H(terms,fields[i],fields[i+1]??0);q.feeTermsHash=F(terms);
 const plan={domain:{...domain,tokenHash:delivery.tokenHash,minimumProtocolFee:prequote.minimumProtocolFee,registry:membership.registry},q,selected,outputs,envelopes,
  amountAtomic,amountSalt,padSeed,blinding,protocolFeeAtomic:protocol.toString(),partnerFeeAtomic:partner.toString(),gasReserveAtomic:gas.toString(),totalDebitAtomic:debit.toString(),
  protocolBps:protocolPolicy.rates[operation],membership,prequote,...(route?{route}:{}),review:{recipient:route?route.receiver:recipient,operation,amountAtomic,...(operation===1&&memo?{memo}:{}),protocolFeeAtomic:protocol.toString(),partnerFeeAtomic:partner.toString(),
   gasReserveAtomic:gas.toString(),totalDebitAtomic:debit.toString(),pool:domain.pool,asset:domain.asset,generationId:domain.generationId,deadline:q.deadline}};
 const witness=await normalWalletWitness({wallet,plan,digest:F(1)}),preview=await funding.preview({width:q.width,...witness});
 if(!same(preview.action.output_commitments,commitments)||selected.notes.some((n,i)=>preview.action.nullifiers[i]!==n.nullifier||preview.action.input_commitments[i]!==n.commitment))fail();
 q.nullifiersHash=enhancedHashNullifiers(preview.action.nullifiers,q.width);plan.preview=preview.action;
 plan.digest=familyNormalDigest(q);signal?.throwIfAborted();return plan;
}
export const familyPrivateSendWitness=input=>{if(input.plan.q.mode!==1)fail();return normalWalletWitness(input);};
export const familyRoutedWalletWitness=input=>{if(![4,5].includes(input.plan.q.mode))fail();return normalWalletWitness(input);};
async function normalWalletWitness({wallet,plan,digest=plan.digest}){
 const keys=await wallet.privateWalletKeys(),q=plan.q;
 return {walletWitness:{schema:'vanta-wallet-witness-v1',checkpoint_ref:plan.selected.source.checkpoint,
  inputs:plan.selected.notes.map(({opening:n})=>({npk:n.npk,token_hash:n.token_hash,value:F(n.amount_units),random:n.random,
   nullifying_key:F(keys.nullifyingKey),pub_key_x:F(keys.spendingPublicKey[0]),pub_key_y:F(keys.spendingPublicKey[1])})),
  outputs:plan.outputs.map(n=>({npk:n.npk,token_hash:n.token_hash,value:F(n.amount_units,true)})),withdraw_amount:F(q.payout??0,true),action_token_hash:plan.outputs[0].token_hash,
  spend_secret_scalar:F(keys.spendSecretScalar),pad_seed:plan.padSeed,
  action:{chain_id:F(plan.domain.chainId),pool:F(plan.domain.pool),action_type:F(q.mode===1?1:6),source_table:F(q.sourceEpoch,true),target_table:F(q.targetEpoch,true),
   token_address:F(plan.domain.asset,true),recipient:F(q.recipient??0,true),protocol_fee:F(0,true),protocol_fee_recipient:F(q.protocolRecipient),
   partner_fee:F(0,true),partner_fee_recipient:F(q.partnerRecipient,true),aux_data_hash:F(0,true)}},
  hashBinding:{public_amount_hash:q.saltedAmountHash,private_amount_salt:plan.amountSalt,batch_digest_field:familyNormalBatchField(q),
   fee_quote_digest_field:F(BigInt(digest)%FR),protocol_fee_cap:F(q.protocolFeeCap,true),partner_fee_cap:F(q.partnerFeeCap,true),leg_index:0,fee_leg_index:0,leg_count:1}};
}
export const proveFamilyWithdrawalPlan=input=>{if(input.plan.q.mode!==0)fail();return proveNormalPlan(input);};
export const proveFamilyPrivateSendPlan=input=>{if(input.plan.q.mode!==1)fail();return proveNormalPlan(input);};
export const proveFamilyRoutedPlan=input=>{if(![4,5].includes(input.plan.q.mode))fail();return proveNormalPlan(input);};
async function proveNormalPlan({wallet,funding,proofRuntime,registry,plan,inventory,signature,assertAuthority,signal}){
 const {q,domain,membership:m,prequote:p}=plan,routed=[4,5].includes(q.mode),witness=await normalWalletWitness({wallet,plan}),preview=await funding.preview({width:q.width,...witness});
 if(!same(preview.action.nullifiers,plan.preview.nullifiers)||!same(preview.action.output_commitments,plan.preview.output_commitments))fail();
 const fee={schema:q.mode===1?'vanta-v8-unified-private-fee-witness-v2':'vanta-v8-unified-private-fee-witness-v1',chain_id:domain.chainId,pool:domain.pool,asset:domain.asset,fee_policy_hash:q.feePolicyHash,
  minimum_protocol_fee_units:p.minimumProtocolFee,fee_caps_units:[q.protocolFeeCap,q.partnerFeeCap,q.relayerFeeCap],collector_mpks:p.routes.map(r=>r.masterPublicKey),
  collector_salts:[p.routes[0].collectorSalt,p.routes[2].collectorSalt],fee_slots:[1,2,3],mode:q.mode,width:q.width,gross_deposit_units:'0',
  outputs:plan.outputs.map(n=>({npk:n.npk,value_units:n.amount_units,random:n.random})),terms_blinding:plan.blinding,signed_quote_digest:plan.digest,
  expected_fee_terms_hash:q.feeTermsHash,...(q.mode!==1?{}:{transfer_protocol_bps:plan.protocolBps,transfer_amount_units:plan.amountAtomic,transfer_amount_salt:plan.amountSalt,
  transfer_amount_hash:q.saltedAmountHash,transfer_batch_digest:familyNormalBatchField(q),transfer_fee_leg_index:0})};
 const partner={schema:'vanta-v8-kzg-partner-witness-v1',signed_quote_digest:plan.digest,signed_partner_nonce:q.nonce,partner_output_commitment:plan.outputs[2].commitment,
  private_fee_terms_hash:q.feeTermsHash,mode:q.mode,width:q.width,gross_deposit_units:'0',amount_hash:q.saltedAmountHash,batch_digest:familyNormalBatchField(q),fee_leg_index:0,
  collector_mpk:p.routes[1].masterPublicKey,receiver_salt:p.routes[1].receiverSalt,quote_nonce_salt:p.nonceSalt,fee_note_random:plan.outputs[2].random,
  fee_note_amount_units:plan.partnerFeeAtomic,reference_amount_units:plan.amountAtomic,amount_salt:plan.amountSalt};
 const walletWitness=registry.bindCombinedWitness({membership:m,fee,partner}),expected=(routed?familyRoutedFeeSignals:familyNormalFeeSignals)({domain,q,outputs:plan.outputs.map(n=>n.commitment),
  protocolCollectorCommitment:await H(p.routes[0].masterPublicKey,p.routes[0].collectorSalt),relayerCollectorCommitment:await H(p.routes[2].masterPublicKey,p.routes[2].collectorSalt),
  protocolBps:plan.protocolBps,policyContext:m.policyContext});
 assertAuthority();signal?.throwIfAborted();const combined=await proofStep('fee proof',()=>proofRuntime.prove({relation:'combined-fee-partner',width:q.width,request:{walletWitness,expectedPublicSignals:expected},signal}));
 const dummies=await Promise.all(Array.from({length:32},(_,i)=>H(0x564c4b5044554d59n,i+1))),
  rows=[...dummies.map(F),...inventory.publicCommitments.filter(n=>n.epoch===q.sourceEpoch&&n.row<plan.selected.source.rows).map(n=>n.commitment)],
  queryRows=[...plan.selected.notes.map(n=>n.row),...Array.from({length:q.width-plan.selected.notes.length},(_,i)=>i+plan.selected.notes.length)];
 if(rows.length!==plan.selected.source.rows||queryRows.some((row,i)=>BigInt(rows[row])!==BigInt(preview.action.input_commitments[i])))fail();
 const cache=await proofStep('note openings',()=>funding.publicCache({snapshot:plan.selected.source,rows,queryRows})),bundle=await proofStep('spending proof',()=>funding.prove({width:q.width,walletWitness:preview.walletWitness,
  hashBinding:witness.hashBinding,authenticatedWalletCache:cache,expectedPublicStatement:preview.action.public_statement,expectedCheckpointRef:plan.selected.source.checkpoint,expectedSourceEpoch:q.sourceEpoch})),
  rowKeys=await funding.rowKeys(Number(p.targetRows));
 assertAuthority();signal?.throwIfAborted();
 const aggregate=routed?await proofStep('payout proof',()=>funding.provePublicTotal({walletWitness:{schema:'vanta-v8-aggregate-payout-witness-v1',chain_id:domain.chainId,
  batch_digest_field:familyNormalBatchField(q),salted_amount_hash:q.saltedAmountHash,public_payout_units:q.payout,private_amount_salt:plan.amountSalt},
  expectedPublicSignals:[familyNormalBatchField(q),F(1),F(q.payout),q.saltedAmountHash,...Array(7).fill(F(0,true)),domain.familyTag,F(domain.chainId)]})):undefined;
 assertAuthority();signal?.throwIfAborted();return (routed?encodeFamilyRoutedSpend:encodeFamilyPrivateSend)({domain,q,signature,preview:preview.action,bundle,combined,aggregate,source:plan.selected.source,rowKeys,envelopes:plan.envelopes,expectedFeeSignals:expected});
}
