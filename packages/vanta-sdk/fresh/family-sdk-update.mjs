import {canonicalJson as canonical} from './canonical-json.mjs';
/** Inspect an update proposal without fetching/importing/executing it. Partner
 * approval and an exact archive digest remain separate from release signing. */
import {getAddress,getBytes,keccak256,sha256,toUtf8Bytes,verifyMessage} from 'ethers';
import {getCompiledFamilyEvmRelease,assertPinnedFamilyEvmManifest} from './family-network.mjs';
import {validateVantaFamilyProofConfiguration} from './family-proof-resources.mjs';
import {STEALTHOS_SDK_VERSION} from './sdk-version.mjs';
import {familyPublicationAuthority} from './family-publication-authority.mjs';

const fail=()=>{throw Error('SDK update does not match the independently pinned archive and signed KZG release.');};
export function inspectVantaFamilySdkUpdate({publication,signature,approvedArchiveSha256,archiveBytes}={}){
 const current=getCompiledFamilyEvmRelease();
 const version=publication?.version;
 if(typeof version!=='string'||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version))fail();
 const proposed=version.split('.').map(Number),installed=STEALTHOS_SDK_VERSION.split('.').map(Number);
 if(proposed.some(v=>!Number.isSafeInteger(v)))fail();
 const first=proposed.findIndex((v,i)=>v!==installed[i]);if(first>=0&&proposed[first]<installed[first])fail();
 if(!publication||JSON.stringify(publication).length>2*1024*1024||publication.schema!=='stealthos-browser-sdk-publication-v1'||
  !/^[0-9a-f]{64}$/u.test(approvedArchiveSha256??'')||!(archiveBytes instanceof Uint8Array)||archiveBytes.length>512*1024*1024||
  sha256(archiveBytes)!=='0x'+approvedArchiveSha256||publication.sdkPackage?.sha256!==approvedArchiveSha256)fail();
 const authority=current.setup.family.activationAuthority,digest=keccak256(toUtf8Bytes('STEALTHOS_VANTA_BROWSER_SDK_PUBLICATION_V1:'+canonical(publication)));
 if(getAddress(verifyMessage(getBytes(digest),signature))!==familyPublicationAuthority(publication,authority))fail();
 const release=publication.sdkRelease;assertPinnedFamilyEvmManifest(release);validateVantaFamilyProofConfiguration(release.proving,release);
 if(release.schema!=='stealthos-family-sdk-release-v2'||release.pins.setupId!==current.pins.setupId||
  release.setup.family.activationAuthority!==authority||release.proving.driver.partnerPolicyScheme!=='kzg-caulk-plus-cclink-v1'||
  publication.setupId!==release.pins.setupId||publication.generationId!==release.pins.generationId||publication.lockId!==release.pins.lockId||
  publication.networkId!==release.pins.networkId||publication.genesisHash!==release.pins.genesisHash||
  publication.resourcesSha256!==release.proving.resourcesSha256||
  publication.sdkReleaseSha256!==sha256(toUtf8Bytes(canonical(release)+'\n')).slice(2))fail();
 if(release.pins.networkId===current.pins.networkId&&release.activation.revision<current.activation.revision)fail();
 return Object.freeze({version:publication.version,archiveSha256:approvedArchiveSha256,networkId:release.pins.networkId,
  generationId:release.pins.generationId,setupId:release.pins.setupId,
  deploymentChanged:release.pins.generationId!==current.pins.generationId,
  requiresExplicitPartnerUpgrade:true,automaticallyMovesFunds:false});
}
