import type {VantaHostContext, VantaHostCommand, VantaHostPayloads,
  VantaHostProgress, VantaHostResult, VantaLocalMessageEvent} from "./host-worker.mjs";

export type VantaHostWorkerRuntime = Readonly<{
  /** Supplied only AFTER verifying compiled activation, deployment and artifact pins. */
  verifiedContext: VantaHostContext;
  /** Include only operations actually implemented for this verified generation. */
  capabilities: readonly VantaHostCommand[];
  execute<C extends VantaHostCommand>(command: C, payload: VantaHostPayloads[C],
    controls: Readonly<{signal: AbortSignal;
      reportProgress(progress: VantaHostProgress): void}>): Promise<VantaHostResult>;
  dispose(): void | Promise<void>;
}>;
export declare function installVantaHostWorkerEndpoint(options: Readonly<{
  /** Dedicated worker scope, never a window message listener for arbitrary origins. */
  scope: Readonly<{
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: VantaLocalMessageEvent) => void): void;
    removeEventListener(type: "message", listener: (event: VantaLocalMessageEvent) => void): void;
  }>;
  /** Compose the existing local fresh WASM engine and trusted native vault here. */
  createRuntime(controls: Readonly<{context: VantaHostContext; signal: AbortSignal;
    reportProgress(progress: VantaHostProgress): void}>):
      VantaHostWorkerRuntime | Promise<VantaHostWorkerRuntime>;
}>): Readonly<{dispose(): void}>;
