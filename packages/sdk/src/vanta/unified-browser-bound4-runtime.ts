/** SDK-managed, SHA-pinned browser runtime for STREAM_BOUND4.
 * Same-origin verified ESM/WASM; no native monolithic proving fallback.
 */
import {createVantaBrowserBound4WorkerFactory,
  type VantaBrowserBound4Release} from "./unified-browser-bound4-workers.js";
import type {VantaV8FullBound4Wasm} from "./unified-gate0-full-bound4-browser.js";
import {createVantaPinnedPublicArtifactReader,VantaPublicArtifactIntegrityError}
  from "./public-artifact-reader.js";
const HASH=/^[0-9a-f]{64}$/iu;
type Runtime=Readonly<{location?:{href:string;origin:string};
  crypto?:{subtle?:{digest(algorithm:string,bytes:Uint8Array):Promise<ArrayBuffer>}}}>;
type Module=VantaV8FullBound4Wasm&Readonly<{
  default(input:{module_or_path:Uint8Array}):Promise<unknown>;
}>;
export async function initializeVantaBrowserBound4ResearchRuntime(input:{
  release:VantaBrowserBound4Release;signal?:AbortSignal;fetcher?:typeof fetch;
}):Promise<Readonly<{wasm:VantaV8FullBound4Wasm;
  createShardWorker:ReturnType<typeof createVantaBrowserBound4WorkerFactory>}>>{
  const runtime=globalThis as unknown as Runtime;
  if(!runtime.crypto?.subtle||!runtime.location)
    throw Error("Vanta browser proving requires secure WebCrypto.");
  const load=async(url:string,expected:string,maxBytes:number)=>{
    if(!HASH.test(expected))throw Error("Invalid Vanta trusted release pin.");
    const u=new URL(url,runtime.location!.href);
    if(!(u.protocol==="https:"||(u.origin===runtime.location!.origin&&u.protocol==="http:"))||u.username||u.password||u.search||u.hash)
      throw Error("Vanta browser artifact must use a secure configured origin.");
    if(input.signal?.aborted)throw Error("Vanta browser proving cancelled.");
    const reader=createVantaPinnedPublicArtifactReader({
      baseUrl:u.origin+"/",fetcher:input.fetcher,signal:input.signal,
      credentials:"omit",allowLocalhostHttp:true,
    });
    let bytes:Uint8Array;
    try{bytes=await reader.read(u.pathname.slice(1),expected,maxBytes);}
    catch(error){
      if(error instanceof VantaPublicArtifactIntegrityError)
        throw Error("Vanta browser artifact SHA-256 mismatch.");
      if(input.signal?.aborted)throw Error("Vanta browser proving cancelled.");
      throw Error("Vanta pinned browser artifact unavailable or invalid.");
    }
    if(bytes.length<1000||bytes.length>maxBytes)
      throw Error("Vanta browser artifact size invalid.");
    return bytes;
  };
  const [glue,wasmBytes]=await Promise.all([
    load(input.release.glueUrl,input.release.glueSha256,500_000),
    load(input.release.wasmUrl,input.release.wasmSha256,20_000_000),
  ]);
  if(input.signal?.aborted){glue.fill(0);wasmBytes.fill(0);
    throw Error("Vanta browser proving cancelled.");}
  // Blob import consumes exactly the digest-verified bytes; no TOCTOU refetch.
  const objectUrl=URL.createObjectURL(new Blob([new Uint8Array(glue)],{type:"text/javascript"}));
  try{
    const module=await import(/* webpackIgnore: true */ /* @vite-ignore */ objectUrl) as Module;
    if(typeof module.default!=="function"||
       typeof module.VantaOfflineMatrixProver!=="function"||
       typeof module.vantaM2SignedDigits!=="function"||
       typeof module.vantaM2CombineG1!=="function"||
       typeof module.vantaM2CombineG2!=="function"||
       typeof module.VantaM2MsmShard?.totalWindows!=="function")
      throw Error("Vanta pinned browser prover exports differ from release.");
    await module.default({module_or_path:wasmBytes});
    if(input.signal?.aborted)throw Error("Vanta browser proving cancelled.");
    return Object.freeze({wasm:module,createShardWorker:createVantaBrowserBound4WorkerFactory(input.release,{glue,wasm:wasmBytes})});
  }finally{
    URL.revokeObjectURL(objectUrl);glue.fill(0);wasmBytes.fill(0);
  }
}
