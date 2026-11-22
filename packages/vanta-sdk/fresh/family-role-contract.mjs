/** Current KZG-only eleven-role SDK contract. Historical ceremony readers
 * live outside the delivered package and cannot select an active profile. */
export const FAMILY_PROFILE_V2="family-eip155-v2";
export const FAMILY_PUBLIC_INPUTS_V2=Object.freeze({
  "combined-fee-partner":40,"enhanced-authorization":19,"enhanced-claim":15,"enhanced-fee-partner":41,
  "gate0-exit-32":6,"gate0-exit-8":6,"gate0-normal-32":6,"gate0-normal-8":6,
  "handle-register":7,"partner-owner":7,"payout-aggregate":13,
});
export const FAMILY_ROLE_IDS_V2=Object.freeze(Object.keys(FAMILY_PUBLIC_INPUTS_V2).sort());
export const FAMILY_PROOF_PROFILES_V2=Object.freeze({normal8:"gate0-normal-8",normal32:"gate0-normal-32",
  exit8:"gate0-exit-8",exit32:"gate0-exit-32",aggregate:"payout-aggregate",combined:"combined-fee-partner",enhanced:"enhanced-fee-partner"});
export const FAMILY_KZG_FEE_PROFILES_V2=Object.freeze(["combined","enhanced"]);
export const FAMILY_STANDARD_STREAM_PROFILES_V2=Object.freeze(["aggregate","combined","enhanced"]);
export const FAMILY_ENHANCED_COMPONENT_PUBLIC_INPUTS_V2=Object.freeze({"enhanced-authorization":19,"enhanced-claim":15});
export function familyRoleContract(profile=FAMILY_PROFILE_V2){
  if(profile!==FAMILY_PROFILE_V2)throw Error("The current SDK requires the KZG eleven-role V2 profile.");
  return Object.freeze({profile,roles:FAMILY_ROLE_IDS_V2,publicInputs:FAMILY_PUBLIC_INPUTS_V2,
    proofs:FAMILY_PROOF_PROFILES_V2,kzgFees:FAMILY_KZG_FEE_PROFILES_V2});
}
export function assertFamilyRoleInventory(ids,profile=FAMILY_PROFILE_V2){
  const expected=familyRoleContract(profile).roles;
  if(!Array.isArray(ids)||ids.length!==expected.length||new Set(ids).size!==expected.length||expected.some(id=>!ids.includes(id)))
    throw Error("Expected complete eleven-role KZG V2 inventory.");
  return true;
}

