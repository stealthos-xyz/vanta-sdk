/** Current KZG-only package gate; historical release tooling is repository-only. */
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {getCompiledFamilyEvmRelease} from "../fresh/family-network.mjs";
import {getCompiledVantaFamilyProofResources} from "../fresh/family-proof-resources.mjs";
import {COMPILED_FAMILY_RELEASE_JSON as release,COMPILED_FAMILY_RELEASE_SHA256 as releaseSha} from "../fresh/generated-family-release.mjs";
import {COMPILED_FAMILY_PROOF_RESOURCES_JSON as resources,COMPILED_FAMILY_PROOF_RESOURCES_SHA256 as resourcesSha} from "../fresh/generated-family-proof-resources.mjs";
import "./current-package-closure.mjs";
import {assertReleaseHygiene} from "./check-release-hygiene.mjs";
if((release===null)!==(releaseSha===null)||(resources===null)!==(resourcesSha===null)||(release===null)!==(resources===null))throw Error("Current family release and resource digest pairs must be configured together.");
if(release!==null)getCompiledVantaFamilyProofResources(getCompiledFamilyEvmRelease());
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
console.log("Release wording checked across "+await assertReleaseHygiene(root)+" first-party files.");
const driver=await readFile(resolve(root,"fresh/family-proof-driver.mjs"),"utf8");
if(/proveVantaV8(?:UnifiedCombinedFeePartner|AggregateBatch|SinglePayoutAggregate)|groth16\.fullProve|MAX_PK_BYTES/u.test(driver))throw Error("Current family driver contains a forbidden whole-key funded proving path.");
console.log(release===null?"Current KZG family SDK is unconfigured; activation remains unavailable.":"Current KZG family release and proof resource pins validated.");
