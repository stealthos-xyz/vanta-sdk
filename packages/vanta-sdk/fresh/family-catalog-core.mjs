import {canonicalJson as canonical} from './canonical-json.mjs';
/** Metadata validation only. Public selection is exclusively through the
 * separately compiled catalog in family-network.mjs, never caller manifests. */
import {getAddress,sha256,toUtf8Bytes,keccak256,verifyMessage,getBytes} from 'ethers';
const fail=message=>{throw Error('SDK KZG catalog: '+message);};
const check=(ok,message)=>{if(!ok)fail(message);};

export const freezeFamilyCatalogValue=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freezeFamilyCatalogValue(x);Object.freeze(v);}return v;};
const hash=text=>sha256(toUtf8Bytes(text)).slice(2);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
export function validateFamilyKzgCatalog({json,sha256:expected,current,validateRelease,validateResources}={}){
 check(typeof json==='string'&&json.length<=8*1024*1024&&/^[0-9a-f]{64}$/u.test(expected??'')&&hash(json)===expected,'catalog bytes differ');
 const catalog=JSON.parse(json);
 check(exact(catalog,['schema','entries'])&&catalog.schema==='stealthos-family-sdk-catalog-v1'&&
  Array.isArray(catalog.entries)&&catalog.entries.length<=32,'unsupported catalog');
 const currentAuthority=getAddress(current.setup.family.activationAuthority),seen=new Set([current.pins.networkId+'/'+current.pins.generationId]),
  active=new Set([current.pins.networkId]),pools=new Set(current.lock.contracts.filter(v=>v.kind==='pool').map(v=>current.pins.networkId+'/'+v.address.toLowerCase()));
 const records=[];
 for(const entry of catalog.entries){
  check(exact(entry,['mode','publication','signature','resourcesJson'])&&['active','withdraw-only'].includes(entry.mode)&&
   typeof entry.resourcesJson==='string'&&entry.resourcesJson.length<=256*1024,'invalid generation entry');
  const publication=entry.publication,release=publication?.sdkRelease;
  check(publication?.schema==='stealthos-browser-sdk-publication-v1'&&release?.schema==='stealthos-family-sdk-release-v2'&&
   release.proving?.driver?.schema==='stealthos-family-bound4-driver-v2'&&
   release.proving.driver.partnerPolicyScheme==='kzg-caulk-plus-cclink-v1','only current KZG proof relations may be retained');
  validateRelease(release);
  check(release.setup.family.id===current.setup.family.id&&release.setup.family.tag===current.setup.family.tag&&
   release.pins.setupId===current.pins.setupId&&getAddress(release.setup.family.activationAuthority)===currentAuthority,
   'generation uses another ceremony, family or authority');
  check(publication.networkId===release.pins.networkId&&publication.generationId===release.pins.generationId&&
   publication.setupId===release.pins.setupId&&publication.genesisHash===release.pins.genesisHash&&publication.lockId===release.pins.lockId&&
   publication.resourcesSha256===release.proving.resourcesSha256&&hash(entry.resourcesJson)===publication.resourcesSha256,
   'publication or proof inventory binding differs');
  const digest=keccak256(toUtf8Bytes('STEALTHOS_VANTA_BROWSER_SDK_PUBLICATION_V1:'+canonical(publication)));
  check(getAddress(verifyMessage(getBytes(digest),entry.signature))===currentAuthority,'publication signature differs');
  const key=release.pins.networkId+'/'+release.pins.generationId;
  check(!seen.has(key),'duplicate generation');seen.add(key);
  if(entry.mode==='active'){check(!active.has(release.pins.networkId),'multiple active generations on one network');active.add(release.pins.networkId);}
  else if(release.pins.networkId===current.pins.networkId)check(release.activation.revision<current.activation.revision,'withdrawal generation must precede the active generation');
  for(const pool of release.lock.contracts.filter(v=>v.kind==='pool')){
   const identity=release.pins.networkId+'/'+pool.address.toLowerCase();
   check(!pools.has(identity),'one pool cannot be rebound to another generation');pools.add(identity);
  }
  const inventory=validateResources(JSON.parse(entry.resourcesJson),release);
  records.push(freezeFamilyCatalogValue({mode:entry.mode,release,inventory,publication,signature:entry.signature}));
 }
 return Object.freeze(records);
}
