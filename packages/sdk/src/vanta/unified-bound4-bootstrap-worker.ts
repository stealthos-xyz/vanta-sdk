/** First-party same-origin, hash-pinned browser MSM shard. No wallet witnesses. */
import {installVantaBound4ShardWorker} from "./unified-bound4-shard-worker.js";
import {createVantaPinnedPublicArtifactReader} from "./public-artifact-reader.js";

type Message=Readonly<Record<string,unknown>>;
type BrowserScope=Readonly<{
  location:{href:string;origin:string};
  crypto:{subtle:{digest(name:string,bytes:Uint8Array):Promise<ArrayBuffer>}};
  addEventListener(type:"message",listener:(event:{data:Message})=>void):void;
  postMessage(data:unknown,transfer?:ArrayBuffer[]):void;
  fetch(url:string,init:{redirect:"error";credentials:"same-origin"}):Promise<{
    ok:boolean;redirected:boolean;type:string;
    arrayBuffer():Promise<ArrayBuffer>;
  }>;
}>;
const scope=globalThis as unknown as BrowserScope;
const HASH=/^[0-9a-f]{64}$/iu;
const fail=(message:string):never=>{throw Error("Vanta browser worker: "+message);};
let started=false;
let routed:((event:{data:Message})=>void)|null=null;
const verified=async(url:string,sha:string,max:number):Promise<Uint8Array>=>{
  const u=new URL(url,scope.location.href);
  if(!(u.protocol==="https:"||(u.origin===scope.location.origin&&u.protocol==="http:"))||u.username||u.password||u.search||u.hash)
    fail("insecure release asset");
  const reader=createVantaPinnedPublicArtifactReader({
    baseUrl:u.origin+"/",credentials:"omit",allowLocalhostHttp:true,
  });
  const bytes=await reader.read(u.pathname.slice(1),sha,max);
  if(bytes.length<1000||bytes.length>max)fail("release asset size invalid");
  return bytes;
};
async function supplied(value:unknown,sha:string,max:number):Promise<Uint8Array> {
  if(!(value instanceof Uint8Array)||value.length<1000||value.length>max)return fail('release asset size invalid');
  const digest=new Uint8Array(await scope.crypto.subtle.digest('SHA-256',value));
  if(Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('')!==sha.toLowerCase())fail('release asset hash invalid');
  return value;
}
async function start(input:Message) {
  if(input.type!=="vanta-bound4-bootstrap"||input.researchOnly!==true||
      (input.profileName!=="8x5"&&input.profileName!=="32x5")||
      typeof input.glueUrl!=="string"||typeof input.wasmUrl!=="string"||
      typeof input.glueSha256!=="string"||!HASH.test(input.glueSha256)||
      typeof input.wasmSha256!=="string"||!HASH.test(input.wasmSha256))
    fail("invalid pinned bootstrap");
  const provided=input.glueBytes!==undefined||input.wasmBytes!==undefined;
  const glue=await (provided?supplied(input.glueBytes,input.glueSha256 as string,500_000):verified(input.glueUrl as string,input.glueSha256 as string,500_000));
  const wasmBytes=await (provided?supplied(input.wasmBytes,input.wasmSha256 as string,20_000_000):verified(input.wasmUrl as string,input.wasmSha256 as string,20_000_000));
  // Blob import uses precisely the verified glue bytes; no subsequent HTTP fetch.
  const objectUrl=URL.createObjectURL(new Blob([new Uint8Array(glue)],{type:"text/javascript"}));
  try {
    const module=await import(/* webpackIgnore: true */ /* @vite-ignore */ objectUrl) as {
      default:(input:{module_or_path:Uint8Array})=>Promise<unknown>;
      VantaM2MsmShard:new(...args:unknown[])=>unknown;
    };
    if(typeof module.default!=="function"||
        typeof module.VantaM2MsmShard!=="function")
      fail("pinned WASM module exports invalid");
    await module.default({module_or_path:wasmBytes});
    installVantaBound4ShardWorker({
      addEventListener(_type,listener){
        routed=event=>listener(event as Parameters<typeof listener>[0]);
      },
      postMessage:(data,transfer)=>scope.postMessage(data,transfer),
    },module as Parameters<typeof installVantaBound4ShardWorker>[1]);
  } finally {
    URL.revokeObjectURL(objectUrl);
    glue.fill(0);wasmBytes.fill(0);
  }
  scope.postMessage({type:"vanta-bound4-ready",profileName:input.profileName});
}
scope.addEventListener("message",(event)=>{
  if(!started){
    started=true;
    void start(event.data).catch((error: unknown)=>{
      const memory = error instanceof RangeError && /memory|allocation/i.test(error.message);
      scope.postMessage({type:"vanta-bound4-fatal",reason:memory?"memory":"startup"});
    });
    return;
  }
  if(routed)routed(event);
  // Client queues proof traffic until the ready handshake is received.
});
