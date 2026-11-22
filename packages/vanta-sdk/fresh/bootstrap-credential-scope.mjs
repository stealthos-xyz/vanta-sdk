/** Credential-only bootstrap context. It cannot activate funded SDK APIs.
 * Bootstrap must be able to prove ownership before a finalized deployment and
 * its public SDK exist. Final keys are authenticated by the signed setup. */
import {getAddress,getBytes,keccak256,sha256,toUtf8Bytes,verifyMessage} from 'ethers';
import {assertFamilyRoleInventory,FAMILY_PROFILE_V2} from './family-role-contract.mjs';
const scopes=new WeakMap(),SHA=/^[0-9a-f]{64}$/u,WORD=/^0x[0-9a-f]{64}$/u;
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':
 v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>sha256(toUtf8Bytes(canonical(v))).slice(2);
const check=(ok,m)=>{if(!ok)throw Error('Bootstrap credentials: '+m);};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sorted=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name,'en'));

/** expected is the operator's already selected ceremony, activation and
 * source-derived deployment plan. Never fill it from a wallet RPC response. */
export function createFamilyBootstrapCredentialScope(descriptor,expected){
 const {setup,activation,familyRelease,networkPolicy,planSha256,handleRegistry,registrar,pools}=descriptor??{};
 check(expected?.familyId==='dogeos'&&setup?.schema==='stealthos-reusable-family-setup-v1'&&WORD.test(setup.setupId)&&
  setup.setupId===expected?.setupId&&setup.family?.id===expected.familyId&&
  getAddress(setup.family.activationAuthority)===getAddress(expected.activationAuthority),
 'The selected setup or authority differs.');
 const {setupId,...setupBody}=setup;
 check(keccak256(toUtf8Bytes(canonical(setupBody)))===setupId,'The setup identity is altered.');
 const familyTag='0x'+(BigInt(keccak256(toUtf8Bytes('STEALTHOS_VANTA_CEREMONY_FAMILY_V1:eip155:dogeos')))%
  21888242871839275222246405745257275088548364400416034343698204186575808495617n).toString(16).padStart(64,'0');
 check(setup.family.namespace==='eip155'&&setup.family.tag===familyTag,'The setup family domain differs.');
 const {signature,...activationBody}=activation??{}, {generationId,...unsignedActivation}=activationBody;
 check(activation.schema==='stealthos-family-network-activation-v1'&&activation.setupId===setupId&&
  activation.familyId===setup.family.id&&activation.familyTag===setup.family.tag&&
  activation.generationId===expected.generationId&&
  keccak256(toUtf8Bytes(canonical(unsignedActivation)))===generationId&&
  /^eip155:[1-9][0-9]*$/u.test(activation.network?.id)&&activation.network.id===expected.networkId&&
  activation.network.genesisHash===expected.genesisHash&&WORD.test(expected.genesisHash)&&
  BigInt(expected.genesisHash)>0n&&
  ['testnet','mainnet'].includes(activation.network.role)&&
  Number.isSafeInteger(activation.revision)&&activation.revision>=0&&activation.revision<2**32,
 'The selected activation or network differs.');
 const digest=keccak256(toUtf8Bytes('STEALTHOS_VANTA_FAMILY_ACTIVATION_V1:'+canonical(activationBody)));
 check(verifyMessage(getBytes(digest),signature)===getAddress(expected.activationAuthority),
 'The network activation is not signed by the selected authority.');
 check(networkPolicy?.schema==='stealthos-reviewed-family-networks-v1'&&
  networkPolicy.familyId===setup.family.id&&networkPolicy.sourceNetworkId==='eip155:'+setup.sourceNetwork.chainId&&
  SHA.test(expected.networkPolicySha256)&&hash(networkPolicy)===expected.networkPolicySha256&&
  Array.isArray(networkPolicy.networks)&&networkPolicy.networks.length<=8&&
  networkPolicy.networks.some(row=>canonical(row)===canonical(activation.network)),
 'The network is outside the pinned DogeOS family policy.');
 check(familyRelease?.schema==='stealthos-family-ceremony-release-v2'&&
  familyRelease.constructionProfile===FAMILY_PROFILE_V2&&familyRelease.beaconFinalized===true&&
  canonical(familyRelease.family)===canonical(setup.family)&&
  familyRelease.ceremony?.id===setup.ceremonyId&&familyRelease.releaseHash===setup.ceremonyReleaseHash&&
  familyRelease.verifierKeysSha256===setup.verifierKeysSha256&&Array.isArray(familyRelease.artifacts),
 'A matching finalized eleven-role KZG ceremony release is required.');
 const {releaseHash,...releaseBody}=familyRelease;
 check(SHA.test(releaseHash)&&hash(releaseBody)===releaseHash,'The ceremony release bytes are altered.');
 assertFamilyRoleInventory(familyRelease.derivations?.map(d=>d.familyId),FAMILY_PROFILE_V2);
 const inventory=sorted(familyRelease.artifacts),artifacts=new Map();
 for(const ref of inventory){
  check(ref&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(ref.name)&&
   !ref.name.split('/').some(p=>p==='.'||p==='..')&&SHA.test(ref.sha256)&&
   Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=128*1024*1024&&!artifacts.has(ref.name),
   'Invalid or repeated final artifact.');
  artifacts.set(ref.name,ref);
 }
 const keyNames=new Set(familyRelease.derivations.flatMap(d=>[d.sourceArtifact,...d.verifierArtifacts]));
 check([...keyNames].every(n=>artifacts.has(n))&&hash(inventory)===setup.artifactInventorySha256&&
  hash(inventory.filter(ref=>keyNames.has(ref.name)))===setup.verifierKeysSha256,
 'The final key or artifact inventory differs from the activated setup.');
 check(SHA.test(planSha256)&&planSha256===expected.planSha256&&
  getAddress(handleRegistry)===getAddress(expected.handleRegistry)&&
  getAddress(registrar)===getAddress(expected.registrar)&&Array.isArray(pools)&&pools.length>=2&&pools.length<=8&&
  canonical(pools)===canonical(expected.pools)&&
  new Set([handleRegistry,registrar,...pools].map(a=>getAddress(a).toLowerCase())).size===pools.length+2,
 'The namespace or pools differ from the selected deployment plan.');
 for(const address of [handleRegistry,registrar,...pools])check(BigInt(getAddress(address))>0n,'Zero bootstrap contract.');
 const credentials=Object.fromEntries(['handle-register','partner-owner'].map(role=>[role,
  Object.fromEntries(Object.entries({witnessWasm:'circuit.wasm',zkey:'final.zkey',verificationKey:'verification-key.json'}).map(([kind,file])=>{
   const name=role+'/'+file,ref=artifacts.get(name);check(ref,'Missing final credential artifact: '+name);
   return [kind,{path:name,sha256:ref.sha256,bytes:ref.bytes}];
  }))]));
 const chainId=Number(activation.network.id.slice(7));
 check(Number.isSafeInteger(chainId)&&chainId>0&&WORD.test(expected.genesisHash),'Invalid target chain.');
 const value=freeze({chainId,networkId:activation.network.id,familyTag:setup.family.tag,setupId,
  generationId,genesisHash:activation.network.genesisHash,planSha256,handleRegistry:getAddress(handleRegistry),
  registrar:getAddress(registrar),pools:pools.map(getAddress),credentials,
  pins:{networkId:activation.network.id},setup:{family:{tag:setup.family.tag}}});
 const ticket=Object.freeze({});scopes.set(ticket,value);return ticket;
}
export function getFamilyBootstrapCredentialContext(ticket){
 const value=scopes.get(ticket);check(value,'An authenticated bootstrap credential scope is required.');return value;
}
