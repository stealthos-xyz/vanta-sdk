/**
 * Same-origin browser-worker side of the existing four-shard STREAM_BOUND4 MSM.
 * A wallet worker must initialize its pinned WASM independently, then install
 * this handler. No note witness, signing key, or wallet cache enters a shard.
 */
type Shard = {
  pushVerifiedChunkDigits(query: Uint8Array, digits: Int16Array,
    pointStart: number, pointCount: number): void;
  finish(): Uint8Array;
  memoryStats?(): Map<string, unknown> | Record<string, unknown>;
  free(): void;
};

export type VantaBound4ShardWasm = Readonly<{
  VantaM2MsmShard: new (curve: string, windowBits: number,
    from: number, to: number, points: number) => Shard;
}>;

type Message = { id: number; type: string; [key: string]: unknown };
export type VantaBound4ShardScope = Readonly<{
  addEventListener(type: "message", listener: (event: {data: Message}) => void): void;
  postMessage(data: unknown, transfer?: ArrayBuffer[]): void;
}>;

/** Call once from a module Web Worker after loading its independently pinned WASM. */
export function installVantaBound4ShardWorker(
  scope: VantaBound4ShardScope, wasm: VantaBound4ShardWasm,
): void {
  let initialized = false;
  let shard: Shard | undefined;
  // Public allocator counts support device qualification. Never retain a
  // witness, scalar, point or signed-digit buffer in telemetry.
  let allocatorPeakBytes: number | undefined;
  const measure = () => {
    if (typeof shard?.memoryStats !== "function") return;
    const raw = shard.memoryStats();
    const peak = raw instanceof Map ? raw.get("peak_bytes") : raw.peak_bytes;
    if (typeof peak === "number" && Number.isSafeInteger(peak) && peak >= 0)
      allocatorPeakBytes = Math.max(allocatorPeakBytes ?? 0, peak);
  };
  const release = () => {
    try { shard?.free(); } catch { /* preserve the original MSM failure */ }
    finally { shard = undefined; }
  };
  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !Number.isSafeInteger(message.id) || message.id <= 0) return;
    try {
      let result: boolean | ArrayBuffer = true;
      if (message.type === "init") {
        if (initialized || (message.width !== 8 && message.width !== 32))
          throw Error("invalid shard initialization");
        initialized = true;
      } else if (message.type === "start") {
        if (!initialized || shard || (message.curve !== "G1" && message.curve !== "G2") ||
            !Number.isSafeInteger(message.windowBits) ||
            !Number.isSafeInteger(message.from) || !Number.isSafeInteger(message.to) ||
            !Number.isSafeInteger(message.points))
          throw Error("invalid shard session");
        shard = new wasm.VantaM2MsmShard(message.curve, message.windowBits as number,
          message.from as number, message.to as number, message.points as number);
      } else if (message.type === "push") {
        if (!shard || !(message.query instanceof ArrayBuffer) ||
            !(message.digits instanceof ArrayBuffer) ||
            !Number.isSafeInteger(message.pointStart) ||
            !Number.isSafeInteger(message.pointCount) ||
            (message.pointCount as number) < 1 || (message.pointCount as number) > 512)
          throw Error("invalid MSM subchunk");
        const query = new Uint8Array(message.query);
        const digits = new Int16Array(message.digits);
        try {
          shard.pushVerifiedChunkDigits(query, digits,
            message.pointStart as number, message.pointCount as number);
        } finally { query.fill(0); digits.fill(0); }
      } else if (message.type === "finish") {
        if (!shard) throw Error("shard session not started");
        try { measure(); result = shard.finish().slice().buffer as ArrayBuffer; measure(); }
        finally { release(); }
      } else {
        throw Error("unknown shard request");
      }
      measure();
      scope.postMessage({id: message.id, type: "success", result,
        ...(allocatorPeakBytes === undefined ? {} : {allocatorPeakBytes})},
        result instanceof ArrayBuffer ? [result] : []);
    } catch {
      release();
      scope.postMessage({id: message.id, type: "error"});
    }
  });
}
