/** Browser half of the private proof-platform import. The public wallet
 * factory still owns the release, resource pins and operation selection. */
import { createVantaBrowserBound4WorkerFactory } from "./family-proof-driver.mjs";

import { createPinnedBindings } from "./family-binding-factories.mjs";

export function assertFamilyProofEnvironment() {
  const Scope = globalThis.DedicatedWorkerGlobalScope;
  if (typeof Scope !== "function" || !(globalThis instanceof Scope) || typeof globalThis.document !== "undefined")
    throw Error("Family STREAM_BOUND4 requires a dedicated local browser proof worker.");
}

export function familyProofArtifactBase(artifactBaseUrl) {
  const location = globalThis.location;
  let base;
  try { base = new URL(artifactBaseUrl, location?.href); } catch { throw Error("Invalid family artifact origin."); }
  if (!location || base.username || base.password || base.search || base.hash ||
      !(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))))
    throw Error("Family proof runtime requires a secure artifact locator.");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

export async function loadFamilyProofModule(glue, bytes) {
  assertFamilyProofEnvironment();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', glue));
  const pin = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  const bindings = createPinnedBindings(pin);
  if (bindings) {
    await bindings.default({ module_or_path: bytes });
    return bindings;
  }
  // Other signed generations retain their original authenticated bindings.
  const url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
  try {
    const wasm = await import(/* webpackIgnore: true */ /* @vite-ignore */ url);
    await wasm.default({ module_or_path: bytes });
    return wasm;
  } finally { URL.revokeObjectURL(url); }
}

export function createFamilyProofWorkerFactory(release,glue,wasm) {
  assertFamilyProofEnvironment();
  return createVantaBrowserBound4WorkerFactory(release,{glue,wasm});
}
