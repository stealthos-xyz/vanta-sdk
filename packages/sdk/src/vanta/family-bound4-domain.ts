/** Fixed KZG family proving selection shared by hosted and trusted native runtimes.
 * This selects code, not authority: a funded loader must separately verify the
 * compiled signed activation and its independently pinned resource inventory.
 */
export const VANTA_DOGEOS_FAMILY_TAG =
  "0x0d7e28190dad8c216f3b244bf15b182aebe3698b85e928461c3b148b4439c445";
export type VantaFamilyBound4Descriptor = Readonly<{
  schema: "stealthos-family-bound4-driver-v2";
  familyId: "dogeos";
  networkId: `eip155:${bigint}`;
  familyTag: typeof VANTA_DOGEOS_FAMILY_TAG;
  engine: "STREAM_BOUND4";
  workerCount: 4;
  partnerPolicyScheme: "kzg-caulk-plus-cclink-v1";
}>;
export type VantaFamilyProofRelation =
  "normal" | "exit" | "payout-aggregate" | "combined-fee-partner" | "enhanced-fee-partner";
export type VantaFamilyProofSelection = Readonly<{
  engine: "STREAM_BOUND4";
  workerCount: 4;
  selectedDriver: string;
  relation: VantaFamilyProofRelation;
  width: 0 | 8 | 32;
  chainId: number;
  familyTag: typeof VANTA_DOGEOS_FAMILY_TAG;
}>;
const KZG_FIELDS = ["schema", "familyId", "networkId", "familyTag", "engine", "workerCount", "partnerPolicyScheme"].sort().join(",");
export function validateVantaFamilyBound4Descriptor(value: unknown): VantaFamilyBound4Descriptor {
  const v = value as VantaFamilyBound4Descriptor | null;
  const chainId = typeof v?.networkId === "string" && /^eip155:[1-9][0-9]{0,15}$/u.test(v.networkId)
    ? Number(v.networkId.slice(7)) : NaN;
  if (!v || typeof v !== "object" || Array.isArray(v) ||
      (v.schema !== "stealthos-family-bound4-driver-v2" || Object.keys(v).sort().join(",") !== KZG_FIELDS || v.partnerPolicyScheme !== "kzg-caulk-plus-cclink-v1") ||
      v.familyId !== "dogeos" || !Number.isSafeInteger(chainId) || chainId <= 0 ||
      v.familyTag !== VANTA_DOGEOS_FAMILY_TAG ||
      v.engine !== "STREAM_BOUND4" || v.workerCount !== 4)
    throw Error("DogeOS family proofs require the pinned four-worker STREAM_BOUND4 driver.");
  return Object.freeze({...v});
}
export function selectVantaFamilyBound4Driver(descriptor: unknown,
  relation: VantaFamilyProofRelation, width: 0 | 8 | 32): VantaFamilyProofSelection {
  const d = validateVantaFamilyBound4Descriptor(descriptor);
  const valid = (relation === "normal" || relation === "exit") ? width === 8 || width === 32
    : relation === "payout-aggregate" ? width === 0
      : relation === "combined-fee-partner" ? width === 0 || width === 8 || width === 32
        : relation === "enhanced-fee-partner" && (width === 8 || width === 32);
  if (!valid) throw Error("Unsupported DogeOS family proof relation or width.");
  if ((relation === "combined-fee-partner" || relation === "enhanced-fee-partner") &&
      (d.schema !== "stealthos-family-bound4-driver-v2" || d.partnerPolicyScheme !== "kzg-caulk-plus-cclink-v1"))
    throw Error("DogeOS fee proofs require the authenticated KZG policy profile.");
  return Object.freeze({engine: d.engine, workerCount: d.workerCount,
    selectedDriver: `vanta-family-${relation}-stream-bound4-${relation === "combined-fee-partner" || relation === "enhanced-fee-partner" ? "kzg-v1" : "v1"}`, relation, width,
    chainId: Number(d.networkId.slice(7)), familyTag: d.familyTag});
}

