/** Headless family dispatch. The descriptor selects a fixed local driver;
 * callers cannot supply another prover or a monolithic fallback. */
import {selectVantaFamilyBound4Driver, validateVantaFamilyBound4Descriptor,
  VANTA_DOGEOS_FAMILY_TAG, type VantaFamilyBound4Descriptor,
  type VantaFamilyProofRelation, type VantaFamilyProofSelection}
  from "../../sdk/src/vanta/family-bound4-domain.js";
import {proveVantaV8FullBound4InWallet}
  from "../../sdk/src/vanta/unified-gate0-full-bound4-browser.js";
import {proveVantaFamilyStandardBound4InWallet, type VantaFamilyStandardBound4Input}
  from "../../sdk/src/vanta/unified-combined-fee-bound4-browser.js";
export {initializeVantaBrowserBound4ResearchRuntime}
  from "../../sdk/src/vanta/unified-browser-bound4-runtime.js";
export {createVantaBrowserBound4WorkerFactory}
  from "../../sdk/src/vanta/unified-browser-bound4-workers.js";
export {selectVantaFamilyBound4Driver, validateVantaFamilyBound4Descriptor, VANTA_DOGEOS_FAMILY_TAG};

type Gate = Omit<Parameters<typeof proveVantaV8FullBound4InWallet>[0], "family" | "width">;
type Selection = Readonly<{descriptor: VantaFamilyBound4Descriptor;
  onSelectedDriver?: (selection: VantaFamilyProofSelection) => void}>;
type Input = Selection & (Gate & Readonly<{relation: "normal" | "exit"; width: 8 | 32}>
  | Omit<VantaFamilyStandardBound4Input, "descriptor">);

/** Execute in a dedicated local proof worker. This entry point is also used
 * by disposable-artifact rehearsal; selecting it does not grant activation. */
export async function proveVantaFamilyBound4InWallet(input: Input) {
  const selected = selectVantaFamilyBound4Driver(input?.descriptor, input?.relation, input?.width);
  const environment = globalThis as unknown as {document?: unknown;
    DedicatedWorkerGlobalScope?: new () => object};
  if (typeof environment.DedicatedWorkerGlobalScope !== "function" ||
      !(globalThis instanceof environment.DedicatedWorkerGlobalScope) || environment.document !== undefined)
    throw Error("Family STREAM_BOUND4 must run in a dedicated local browser proof worker.");
  input.signal?.throwIfAborted();
  input.onSelectedDriver?.(selected);
  if (input.relation === "normal" || input.relation === "exit") {
    return proveVantaV8FullBound4InWallet({...input,
      family: {descriptor: input.descriptor, relation: input.relation}});
  }
  return proveVantaFamilyStandardBound4InWallet(input as VantaFamilyStandardBound4Input);
}

/** Operations select their required relation set here; an aggregate cannot
 * be silently substituted for a normal/exit proof or combined fee proof. */
export function selectVantaFamilyOperationProofs(descriptor: VantaFamilyBound4Descriptor,
  operation: "deposit" | "privateSend" | "withdraw" | "exit" | "aggregate",
  width: 0 | 8 | 32): readonly VantaFamilyProofSelection[] {
  validateVantaFamilyBound4Descriptor(descriptor);
  let relations: VantaFamilyProofRelation[];
  if (operation === "deposit" && width === 0) relations = ["combined-fee-partner"];
  else if ((operation === "privateSend" || operation === "withdraw") && (width === 8 || width === 32))
    relations = ["combined-fee-partner", "normal"];
  else if (operation === "exit" && (width === 8 || width === 32)) relations = ["exit"];
  else if (operation === "aggregate" && width === 0) relations = ["payout-aggregate"];
  else throw Error("Unsupported family wallet operation or proof width.");
  return Object.freeze(relations.map(relation => selectVantaFamilyBound4Driver(descriptor, relation, width)));
}
