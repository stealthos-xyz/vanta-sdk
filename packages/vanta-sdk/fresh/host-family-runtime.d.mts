import type {VantaFamilyPartnerRegistry} from "./family-partner-registry.mjs";
import type {VantaFamilyProofRuntime} from "./family-proof-runtime.mjs";
import type {VantaHostWorkerRuntime} from "./host-worker-endpoint.mjs";
import type {VantaHostContext,VantaHostProgress} from "./host-worker.mjs";
import type {verifyCompiledFamilyEvmRuntime} from "./family-network.mjs";
type Provider=Parameters<typeof verifyCompiledFamilyEvmRuntime>[0];
type VerifiedRelease=Awaited<ReturnType<typeof verifyCompiledFamilyEvmRuntime>>;
type Controls=Readonly<{context:VantaHostContext;signal:AbortSignal;
  reportProgress(progress:VantaHostProgress):void}>;
export function createVantaFamilyHostRuntimeFactory(options:{provider:Provider;
  /** Required for the partners capability; omitted proof-only hosts receive partners:null. */
  verificationProvider?:Provider;
  proofArtifacts?:Readonly<{artifactBaseUrl:string;fetcher?:typeof fetch}>;
  initializeRuntime(controls:Controls&Readonly<{verifiedRelease:VerifiedRelease;proofs:VantaFamilyProofRuntime|null;partners:VantaFamilyPartnerRegistry|null}>):
    Omit<VantaHostWorkerRuntime,"verifiedContext">|Promise<Omit<VantaHostWorkerRuntime,"verifiedContext">>;
}):(controls:Controls)=>Promise<VantaHostWorkerRuntime>;
