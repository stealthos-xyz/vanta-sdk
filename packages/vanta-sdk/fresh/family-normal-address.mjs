/** Versioned public receiving address. Decoding validates format; the wallet
 * host additionally enforces its signed network, generation, pool and asset. */
import {encodeBase64,decodeBase64,toUtf8Bytes,toUtf8String,getAddress} from 'ethers';
const fields=['schema','familyTag','chainId','genesisHash','generationId','setupId','pool','asset','masterPublicKey','viewingPublicKey'],
 FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n,
 fail=()=>{throw Error('Invalid StealthOS private receiving address.');};
function recipient(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==fields.slice().sort().join()||
  value.schema!=='vanta-family-note-recipient-v1'||!Number.isSafeInteger(value.chainId)||value.chainId<1)fail();
 for(const name of ['familyTag','genesisHash','generationId','setupId','masterPublicKey','viewingPublicKey'])
  if(typeof value[name]!=='string'||!/^0x[0-9a-f]{64}$/u.test(value[name])||BigInt(value[name])===0n)fail();
 if(BigInt(value.familyTag)>=FR||BigInt(value.masterPublicKey)>=FR)fail();
 for(const name of ['pool','asset']){try{if(getAddress(value[name]).toLowerCase()!==value[name]||name==='pool'&&BigInt(value[name])===0n)fail();}catch{fail();}}
 return Object.freeze(Object.fromEntries(fields.map(name=>[name,value[name]])));
}
export function encodeVantaFamilyReceivingAddress(value){
 const checked=recipient(value);return 'vanta:1:'+encodeBase64(toUtf8Bytes(JSON.stringify(checked))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
}
export function decodeVantaFamilyReceivingAddress(value){
 if(typeof value!=='string'||value.length>2048||!/^vanta:1:[A-Za-z0-9_-]+$/u.test(value))fail();
 try{const payload=value.slice(8).replaceAll('-','+').replaceAll('_','/'),padded=payload+'='.repeat((4-payload.length%4)%4),
  checked=recipient(JSON.parse(toUtf8String(decodeBase64(padded))));
  if(encodeVantaFamilyReceivingAddress(checked)!==value)fail();return checked;
 }catch{fail();}
}
