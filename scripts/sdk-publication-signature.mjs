import {isFamilyPublicationAuthority} from './sdk-publication-authority.mjs';
import {getBytes,keccak256,toUtf8Bytes,verifyMessage} from 'ethers';
const authority='0x1162ae2d023773aa526d63c11da14e4e40209093';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':
 '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function assertSignedChikyuSdkPublication(publication){
 const {signature,artifactBaseUrl,...signed}=publication;
 const digest=keccak256(toUtf8Bytes('STEALTHOS_VANTA_BROWSER_SDK_PUBLICATION_V1:'+canonical(signed)));
 try{if(publication.networkId!=='eip155:6281971'||!isFamilyPublicationAuthority(publication,authority,verifyMessage(getBytes(digest),signature)))throw Error();}
 catch{throw Error('Activate the exact SDK publication in the operator wallet before production deployment.');}
 return digest;
}
