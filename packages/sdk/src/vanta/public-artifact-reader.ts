/** Bounded, hash-pinned public artifact reads. No wallet witness is accepted. */
import {sha256} from "ethers";
const HASH=/^[a-f0-9]{64}$/iu;
const MAX_RANGE=2*1024*1024;
const fail=():never=>{throw Error("Vanta pinned public artifact unavailable or invalid");};
export class VantaPublicArtifactIntegrityError extends Error {
  constructor(){super("Vanta public artifact SHA-256 mismatch");this.name="VantaPublicArtifactIntegrityError";}
}
export function resolveVantaPublicArtifactBaseUrl(value:string):string {
  if(value.startsWith("/")&&!value.startsWith("//")){
    const runtime=globalThis as unknown as {location?:{href:string}};
    if(!runtime.location)throw Error("Provide an HTTPS artifact base URL outside a browser");
    return new URL(value,runtime.location.href).href;
  }
  return value;
}

export function createVantaPinnedPublicArtifactReader(input:{
  baseUrl:string;fetcher?:typeof fetch;signal?:AbortSignal;
  credentials?:"omit"|"same-origin";
  allowLocalhostHttp?:true;
}):Readonly<{
  url(path:string):string;
  read(path:string,expectedSha256:string,maxBytes:number):Promise<Uint8Array>;
  range(path:string,offset:number,length:number,total:number):Promise<Uint8Array>;
}> {
  const base=new URL(input.baseUrl);
  const local=input.allowLocalhostHttp===true&&base.protocol==="http:"&&
    ["localhost","127.0.0.1"].includes(base.hostname);
  if((base.protocol!=="https:"&&!local)||base.username||base.password||base.search||base.hash||
      (input.credentials!==undefined&&!["omit","same-origin"].includes(input.credentials)))
    throw Error("Vanta public artifacts require a credential-free HTTPS base URL");
  if(!base.pathname.endsWith("/"))base.pathname+="/";
  const url=(path:string)=>{
    if(!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(path)||
       path.split("/").some(v=>v==="."||v===".."))return fail();
    const result=new URL(path,base);
    if(result.origin!==base.origin||!result.pathname.startsWith(base.pathname))return fail();
    return result.href;
  };
  const fetchBytes=async(path:string,maxBytes:number,range?:{offset:number;length:number;total:number})=>{
    if(input.signal?.aborted)throw Error("Vanta proof cancelled");
    let response:Response;
    try{response=await(input.fetcher??fetch)(url(path),{
      credentials:input.credentials??"omit",redirect:"error",signal:input.signal,
      ...(range?{headers:{Range:"bytes="+range.offset+"-"+(range.offset+range.length-1)}}:{}),
    });}catch{
      if(input.signal?.aborted)throw Error("Vanta proof cancelled");
      return fail();
    }
    if(response.redirected||response.type==="opaque"||
       response.status!==(range?206:200))return fail();
    if(range&&response.headers.get("content-range")!==
       "bytes "+range.offset+"-"+(range.offset+range.length-1)+"/"+range.total)return fail();
    const size=response.headers.get("content-length");
    if(size!==null&&(!/^[0-9]+$/u.test(size)||Number(size)>maxBytes||
       (range&&Number(size)!==range.length)))return fail();
    // Bound memory even if a server omits or lies about Content-Length.
    const reader=response.body?.getReader();
    if(!reader)return fail();
    const parts:Uint8Array[]=[];
    let length=0;
    try{
      for(;;){
        const item=await reader.read();
        if(item.done)break;
        length+=item.value.byteLength;
        if(length>maxBytes){await reader.cancel();return fail();}
        parts.push(item.value);
      }
    }finally{reader.releaseLock();}
    if(length<1||(range&&length!==range.length))return fail();
    const bytes=new Uint8Array(length);
    let position=0;
    for(const part of parts){bytes.set(part,position);position+=part.byteLength;}
    return bytes;
  };
  return Object.freeze({
    url,
    async read(path,expected,maxBytes){
      if(!HASH.test(expected)||!Number.isSafeInteger(maxBytes)||maxBytes<1||
         maxBytes>64*1024*1024)return fail();
      const bytes=await fetchBytes(path,maxBytes);
      if(sha256(bytes).slice(2).toLowerCase()!==expected.toLowerCase()){
        bytes.fill(0);throw new VantaPublicArtifactIntegrityError();
      }
      return bytes;
    },
    async range(path,offset,length,total){
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||
         length<1||length>MAX_RANGE||!Number.isSafeInteger(total)||total<1||
         total>128*1024*1024||offset+length>total)return fail();
      return fetchBytes(path,length,{offset,length,total});
    },
  });
}
