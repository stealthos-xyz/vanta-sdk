/** Browser wallet's four-worker STREAM_BOUND4 bootstrap.
 * Every worker verifies the same-origin glue+WASM pins before accepting MSM
 * chunks. The SDK retains proof orchestration, partners provide release URLs.
 */
import type {VantaBound4ShardWorker} from "./unified-combined-fee-bound4-browser.js";

const HASH=/^[0-9a-f]{64}$/iu;
const MAX_QUEUE=16;
export type VantaBrowserBound4Release=Readonly<{
  researchOnly:true;
  profileName:"8x5"|"32x5";
  glueUrl:string;
  wasmUrl:string;
  glueSha256:string;
  wasmSha256:string;
}>;

type EventCallback=(event:{data?:unknown;error?:unknown})=>void;
type BrowserWorker=Readonly<{
  postMessage(data:unknown,transfer?:ArrayBuffer[]):void;
  addEventListener(type:"message"|"error",cb:EventCallback):void;
  terminate():void;
}>;
type WorkerConstructor=new(url:URL,options:{type:"module"})=>BrowserWorker;
type Runtime=Readonly<{
  Worker?:WorkerConstructor;
  location?:{href:string;origin:string;protocol:string;hostname:string};
}>;

export function createVantaBrowserBound4WorkerFactory(
  release:VantaBrowserBound4Release,
  artifacts?:Readonly<{glue:Uint8Array;wasm:Uint8Array}>,
):()=>VantaBound4ShardWorker {
  const runtime=globalThis as unknown as Runtime;
  if(release?.researchOnly!==true||
      (release.profileName!=="8x5"&&release.profileName!=="32x5")||
      !HASH.test(release.glueSha256)||!HASH.test(release.wasmSha256)||
      typeof release.glueUrl!=="string"||typeof release.wasmUrl!=="string"||
      typeof runtime.Worker!=="function"||!runtime.location)
    throw Error("Vanta browser BOUND4 requires a pinned research release and Web Workers");
  const root=runtime.location;
  if(root.protocol!=="https:"&&
      !(root.protocol==="http:"&&
        (root.hostname==="localhost"||root.hostname==="127.0.0.1")))
    throw Error("Vanta browser BOUND4 requires a secure same-origin context");
  const glue=new URL(release.glueUrl,root.href),wasm=new URL(release.wasmUrl,root.href);
  if(glue.origin!==wasm.origin||
      !(glue.protocol==="https:"||(glue.origin===root.origin&&glue.protocol==="http:"))||
      !glue.pathname.endsWith(".js")||!wasm.pathname.endsWith(".wasm")||
      glue.username||glue.password||wasm.username||wasm.password||
      glue.search||glue.hash||wasm.search||wasm.hash)
    throw Error("Vanta BOUND4 WASM and glue must use pinned secure URLs on one artifact origin");
  const config=Object.freeze({
    type:"vanta-bound4-bootstrap",
    researchOnly:true,profileName:release.profileName,
    glueUrl:glue.href,wasmUrl:wasm.href,
    glueSha256:release.glueSha256.toLowerCase(),
    wasmSha256:release.wasmSha256.toLowerCase(),
  });
  // Public bytes stay private to this factory. Each shard hashes its own
  // transferred copy before importing or instantiating them.
  const pinned=artifacts?{glue:artifacts.glue.slice(),wasm:artifacts.wasm.slice()}:undefined;
  return ()=>{
    const worker=new runtime.Worker!(new URL("./unified-bound4-bootstrap-worker.js",import.meta.url),{
      type:"module",
    });
    let ready=false,stopped=false;
    const queue:{message:unknown;transfer?:ArrayBuffer[]}[]=[];
    const listeners={message:new Set<EventCallback>(),error:new Set<EventCallback>()};
    const fail=(message="Vanta pinned BOUND4 worker failed")=>{
      if(stopped)return;
      stopped=true;queue.length=0;
      for(const cb of listeners.error)cb({error:Error(message)});
      worker.terminate();
    };
    worker.addEventListener("error",()=>fail());
    worker.addEventListener("message",(event)=>{
      const data=event.data as {type?:unknown;profileName?:unknown;reason?:unknown}|null;
      if(data?.type==="vanta-bound4-fatal"){fail(data.reason==="memory"?"Vanta worker memory exhausted":"Vanta worker bootstrap failed");return;}
      if(data?.type==="vanta-bound4-ready"){
        if(ready||data.profileName!==release.profileName){fail();return;}
        ready=true;
        for(const item of queue)worker.postMessage(item.message,item.transfer);
        queue.length=0;
        return;
      }
      if(!ready){fail();return;}
      for(const cb of listeners.message)cb(event);
    });
    if(pinned){
      const glueBytes=pinned.glue.slice(),wasmBytes=pinned.wasm.slice();
      worker.postMessage({...config,glueBytes,wasmBytes},[glueBytes.buffer as ArrayBuffer,wasmBytes.buffer as ArrayBuffer]);
    }else worker.postMessage(config);
    return Object.freeze({
      postMessage(message:unknown,transfer?:ArrayBuffer[]){
        if(stopped)throw Error("Vanta BOUND4 worker terminated");
        if(ready)worker.postMessage(message,transfer);
        else{
          if(queue.length>=MAX_QUEUE)throw Error("Vanta BOUND4 bootstrap overflow");
          queue.push({message,transfer});
        }
      },
      addEventListener(type:"message"|"error",callback:EventCallback){
        listeners[type].add(callback);
      },
      removeEventListener(type:"message"|"error",callback:EventCallback){
        listeners[type].delete(callback);
      },
      terminate(){
        if(stopped)return;stopped=true;queue.length=0;worker.terminate();
      },
    });
  };
}
