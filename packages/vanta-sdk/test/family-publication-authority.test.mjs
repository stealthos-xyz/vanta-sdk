import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getAddress} from 'ethers';
import {CHIKYU_SOFTWARE_ADMIN_RECOVERY as r,familyPublicationAuthorities,isFamilyPublicationAuthority} from '../fresh/family-publication-authority.mjs';
import {assertSignedChikyuSdkPublication} from '../../../scripts/sdk-publication-signature.mjs';
const active=JSON.parse(await readFile(new URL('../../../releases/0.4.67/publication.json',import.meta.url),'utf8'));
test('historical publication bytes and their real signatures are unchanged',async()=>{
 for(const version of ['0.4.66','0.4.67']){
  const publication=JSON.parse(await readFile(new URL('../../../releases/'+version+'/publication.json',import.meta.url),'utf8'));
  assert.match(assertSignedChikyuSdkPublication(publication),/^0x[0-9a-f]{64}$/u);
  assert.equal(isFamilyPublicationAuthority(publication,r.originalAuthority,r.additionalAuthority),false);
 }
});
test('additional software signer is checksum valid and only allowed within the frozen future release scope',()=>{
 const future={...active,version:'0.4.68'};
 assert.equal(getAddress(r.additionalAuthority),r.additionalAuthority);
 assert.deepEqual(familyPublicationAuthorities(active,r.originalAuthority),[r.authority]);
 assert.deepEqual(familyPublicationAuthorities(future,r.originalAuthority),[r.authority,r.additionalAuthority]);
 for(const key of ['networkId','genesisHash','setupId','generationId','lockId']){
  const mismatch=structuredClone(future);mismatch[key]='wrong';
  assert.equal(isFamilyPublicationAuthority(mismatch,r.originalAuthority,r.additionalAuthority),false);
  const wrongPin=structuredClone(future);wrongPin.sdkRelease.pins[key]='wrong';
  assert.equal(isFamilyPublicationAuthority(wrongPin,r.originalAuthority,r.additionalAuthority),false);
 }
 for(const version of ['0.4.42','0.4.67','0.4.068','0.4.68x','0.5.68','0.4.68.1'])assert.equal(isFamilyPublicationAuthority({...future,version},r.originalAuthority,r.additionalAuthority),false);
 assert.equal(isFamilyPublicationAuthority(future,r.authority,r.additionalAuthority),false);
 assert.equal(isFamilyPublicationAuthority(future,r.originalAuthority,r.originalAuthority),false);
 assert.throws(()=>assertSignedChikyuSdkPublication(future),/operator wallet/);
});
