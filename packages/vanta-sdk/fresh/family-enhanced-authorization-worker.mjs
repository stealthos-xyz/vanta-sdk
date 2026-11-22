// This entry point is embedded in both browser bundles. All code and artifact
// inputs come from the local wallet worker. This worker only computes the proof.
function authorizationWorker() {
  self.onmessage = async ({ data: { glue, module, witness, release, key } }) => {
    self.onmessage = null;
    const url = URL.createObjectURL(glue);
    let result;
    try {
      const wasm = await import(/* webpackIgnore: true */ /* @vite-ignore */ url);
      await wasm.default({ module_or_path: module });
      result = wasm.prove_enhanced_authorization(witness, release, key);
    } catch {
      // Report failure without logging private inputs or the raw exception.
    } finally {
      key.fill(0);
      URL.revokeObjectURL(url);
    }
    self.postMessage({ result });
  };
}

export async function proveEnhancedAuthorizationInWorker({ glue, module, witness, release, key, signal }) {
  signal?.throwIfAborted();
  const script = new Blob([`(${authorizationWorker.toString()})();`], { type: "text/javascript" });
  const url = URL.createObjectURL(script);
  let worker, timer, abort;
  try {
    worker = new Worker(url, { type: "module", name: "vanta-enhanced-authorization" });
    return await new Promise((resolve, reject) => {
      const fail = () => reject(Error("Local enhanced authorization worker failed."));
      abort = () => reject(signal.reason);
      worker.onmessage = ({ data }) => {
        if (typeof data?.result === "string") resolve(data.result);
        else fail();
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      timer = setTimeout(() => reject(Error("Local enhanced authorization proof timed out.")), 120000);
      signal?.addEventListener("abort", abort, { once: true });
      signal?.throwIfAborted();
      worker.postMessage({ glue, module, witness, release, key }, [key.buffer]);
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}
