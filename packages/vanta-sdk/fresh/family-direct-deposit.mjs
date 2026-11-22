/** Direct deposit intent construction. No server issues a transaction quote. */
import {TypedDataEncoder,hexlify,randomBytes,toBeHex} from 'ethers';
import {buildPoseidon} from '../dist/vendor/circom-crypto.browser.js';
import {depositPoolAbi} from './family-deposit-wire.mjs';
export const DIRECT_DEPOSIT_TYPES=Object.freeze({PrivateFeeDepositQuote:depositPoolAbi.getFunction('privateDepositQuoteDigest').inputs[0].components.map(({name,type})=>({name,type}))});
const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
let poseidon;
export async function buildDirectFamilyDepositIntent({chainId,pool,asset,fee,draft,source,partnerId,timestamp,validUntil,nonceSalt}){
 const salt=nonceSalt===undefined?BigInt(hexlify(randomBytes(48)))%FR:BigInt(nonceSalt);
 if(salt<=0n||salt>=FR||BigInt(partnerId)<=0n||BigInt(partnerId)>=FR||!Number.isSafeInteger(timestamp)||
  !Number.isSafeInteger(validUntil)||validUntil<=timestamp+30)throw Error('Invalid direct deposit nonce or clearance lifetime.');
 const H=await(poseidon??=buildPoseidon()),nonce=BigInt(H.F.toObject(H([BigInt(partnerId),salt])));
 if(nonce===0n)throw Error('Invalid direct deposit nonce.');
 const quote=Object.freeze({chainId:BigInt(chainId),pool,asset,epoch:BigInt(source.epoch),checkpoint:BigInt(source.checkpoint),
  payer:draft.payer,count:3,gross:BigInt(draft.gross),protocolFeeCap:0n,partnerFeeCap:BigInt(draft.partnerFeeCap),
  protocolRecipient:fee.protocolRecipient,partnerRecipient:fee.partnerRecipient,outputsHash:draft.outputsHash,
  envelopesHash:draft.envelopesHash,feeSlotsHash:draft.feeSlotsHash,feeTermsHash:BigInt(draft.feeTermsHash),
  partnerRegistryRoot:BigInt(draft.partnerRegistryRoot),nonce:toBeHex(nonce,32),deadline:BigInt(Math.min(timestamp+600,validUntil)),feePolicyHash:fee.policyHash});
 if(quote.gross<=0n||quote.partnerFeeCap<0n||quote.partnerFeeCap>=quote.gross)throw Error('Invalid direct deposit fee split.');
 const digest=TypedDataEncoder.hash({name:'StealthOS Vanta V8 PreAudit',version:'1',chainId,verifyingContract:pool},DIRECT_DEPOSIT_TYPES,quote);
 return Object.freeze({quote,digest,walletPartnerNonceSalt:toBeHex(salt,32)});
}
