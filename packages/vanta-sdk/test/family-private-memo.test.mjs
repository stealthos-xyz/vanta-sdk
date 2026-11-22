import {test} from 'node:test';
import assert from 'node:assert/strict';
import {x25519} from '@noble/curves/ed25519';
import {hexlify,keccak256} from 'ethers';
import {createFamilyNoteDelivery,familyNoteTokenHash,normalizeFamilyPrivateMemo} from '../fresh/family-note-delivery.mjs';

const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const domain={schema:'vanta-family-note-domain-v1',safeForFunds:false,chainId:6281971,
 familyTag:'0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445',
 genesisHash:word(5),generationId:word(3),setupId:word(4),pool:'0x'+'11'.repeat(20),asset:'0x'+'00'.repeat(20),
 poolCodehash:keccak256('0x6000'),nativeGlueSha256:'11'.repeat(32),nativeWasmSha256:'22'.repeat(32)};
const flags={chain_id:6281971,family_tag:domain.familyTag,research_only:true,safe_for_funds:false};
const note={...flags,schema:'vanta-family-note-opening-v1',npk:word(11),commitment:word(12),random:word(13),
  token_hash:familyNoteTokenHash(domain),amount_units:((1n<<120n)-1n).toString(),nonspendable:false};
const engine={glueSha256:domain.nativeGlueSha256,wasmSha256:domain.nativeWasmSha256,
  createVantaFamilyOwnedNote:()=>JSON.stringify(note),createVantaFamilyRecipientNote:()=>JSON.stringify(note),
  verifyVantaFamilyRecipientNote:r=>JSON.stringify({...flags,schema:'vanta-family-recipient-note-verified-v1',
   master_public_key:r.recipient_master_public_key,commitment:r.commitment,nonspendable:false}),
  verifyVantaFamilyOwnedNote:r=>JSON.stringify({...flags,schema:'vanta-family-owned-note-verified-v1',
   master_public_key:word(14),commitment:r.commitment,nonspendable:false,nullifier:word(15)})};
function makeWallet(){
 const viewingPrivateKey=crypto.getRandomValues(new Uint8Array(32)),viewingPublicKey=x25519.getPublicKey(viewingPrivateKey);
 return {privateWalletKeys:async()=>({viewingPrivateKey,viewingPublicKey,masterPublicKey:14n,spendingPublicKey:[17n,18n],
  spendSecretScalar:19n,nullifyingKey:20n})};
}
test('a maximum-length memo fits in the original envelope, and only its recipient reads it',async()=>{
 const delivery=createFamilyNoteDelivery({domain,engine}),owner=makeWallet();
 const recipient=await delivery.walletRecipient(owner),memo='🐕'.repeat(20);
 const encrypted=await delivery.encrypt({recipient,note,memo});
 const envelope=await delivery.encrypt({recipient,note});
 assert.equal(encrypted.length,2+829*2);
 assert.equal(encrypted.length,envelope.length);
 assert.equal(await delivery.decrypt({wallet:makeWallet(),envelope:encrypted,commitment:note.commitment}),null);
 const original=await delivery.decrypt({wallet:owner,envelope,commitment:note.commitment});
 const recovered=await delivery.decrypt({wallet:owner,envelope:encrypted,commitment:note.commitment});
 assert.equal(original.memo,undefined);
 assert.deepEqual(recovered,{...original,memo});
 if(process.env.VANTA_LEGACY_DELIVERY_MODULE){
  const {createFamilyNoteDelivery:legacy}=await import(process.env.VANTA_LEGACY_DELIVERY_MODULE);
  assert.deepEqual(await legacy({domain,engine}).decrypt({wallet:owner,envelope:encrypted,commitment:note.commitment}),original);
 }
 assert.equal(normalizeFamilyPrivateMemo('   '),undefined);
 assert.throws(()=>normalizeFamilyPrivateMemo(memo+'x'),/80 UTF-8/);
 assert.throws(()=>normalizeFamilyPrivateMemo('a'+String.fromCharCode(0)+'b'),/80 UTF-8/);
});
