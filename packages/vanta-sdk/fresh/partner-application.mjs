/** Public app metadata. Contract addresses and proof keys always come from the
 * sealed release, never from a partner's downloaded configuration. */
import {keccak256,toUtf8Bytes} from 'ethers';
export function normalizePartnerApplication(value){
 const fail=()=>{throw Error('Enter an app name and HTTPS app origins. No partner backend is required.');};
 const legacy=Object.keys(value??{}).sort().join()==='authorizationUrl,name,origins';
 if(!value||!legacy&&Object.keys(value).sort().join()!=='name,origins'||typeof value.name!=='string'||
  value.name!==value.name.trim()||value.name.length<1||value.name.length>80||!Array.isArray(value.origins)||value.origins.length<1||value.origins.length>8)fail();
 const origins=value.origins.map(raw=>{let u;try{u=new URL(raw);}catch{fail();}
  if(u.protocol!=='https:'||u.origin!==raw||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail();return u.origin;});
 if(new Set(origins).size!==origins.length||JSON.stringify(origins)!==JSON.stringify([...origins].sort()))fail();
 if(!legacy)return Object.freeze({name:value.name,origins:Object.freeze(origins)});
 let endpoint;try{endpoint=new URL(value.authorizationUrl);}catch{fail();}
 if(endpoint.protocol!=='https:'||!origins.includes(endpoint.origin)||endpoint.pathname!=='/api/vanta-v8/partner/authorize'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)fail();
 return Object.freeze({name:value.name,origins:Object.freeze(origins),authorizationUrl:endpoint.href});
}
export function partnerApplicationHash(value){const app=normalizePartnerApplication(value);
 return keccak256(toUtf8Bytes(JSON.stringify(app.authorizationUrl?[app.name,app.origins,app.authorizationUrl]:['stealthos-partner-app-v2',app.name,app.origins])));}
