import {webcrypto} from 'node:crypto';
import {VantaFreshPrivateWallet} from '../fresh/wallet-runtime.mjs';
import {getCompiledFamilyEvmRelease} from '../fresh/family-network.mjs';
/** Runs on the partner's own server. This never uploads a backup to StealthOS. */
export function createEncryptedPartnerWalletLoader({partnerHandle,handleId,readBackup,readPassword}){
 if(typeof readBackup!=='function'||typeof readPassword!=='function'||!/^0x[0-9a-f]{64}$/u.test(handleId??''))throw Error('Configure a partner-owned encrypted wallet vault.');
 return async input=>{
  const release=getCompiledFamilyEvmRelease();
  if(input.handleId!==handleId||input.networkId!==release.pins.networkId||input.generationId!==release.pins.generationId)throw Error('Authorization belongs to another partner or deployment.');
  const backup=await readBackup(),password=await readPassword(),h=backup?.header;
  if(h?.schema!=='stealthos-partner-recovery-v1'||backup.kdf!=='PBKDF2-SHA256'||backup.iterations!==600000||typeof password!=='string'||password.length<16)throw Error('Invalid partner vault.');
  const bytes=v=>{if(typeof v!=='string'||v.length>1400000||!/^[A-Za-z0-9+/]*={0,2}$/u.test(v))throw Error('Invalid partner vault.');return new Uint8Array(Buffer.from(v,'base64'));};
  const salt=bytes(backup.salt),iv=bytes(backup.iv),pw=new TextEncoder().encode(password);let plaintext,wallet;
  if(salt.length!==32||iv.length!==12)throw Error('Invalid partner vault.');
  try{
   const material=await webcrypto.subtle.importKey('raw',pw,'PBKDF2',false,['deriveKey']);
   const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
   plaintext=new Uint8Array(await webcrypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(JSON.stringify(h))},key,bytes(backup.ciphertext)));
   const saved=JSON.parse(new TextDecoder().decode(plaintext));wallet=await VantaFreshPrivateWallet.restore(saved.recoveryPhrase);
   const route=await wallet.exportFamilyPartnerReceivingRoute({handle:partnerHandle});if(route.handleId!==handleId)throw Error('Partner vault does not own the configured handle.');
   return wallet;
  }catch{wallet?.dispose();throw Error('Partner wallet vault could not be unlocked.');}finally{pw.fill(0);plaintext?.fill(0);}
 };
}
