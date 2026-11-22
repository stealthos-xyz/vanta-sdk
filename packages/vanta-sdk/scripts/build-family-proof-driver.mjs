/** Ship the same reviewed local four-worker drivers used by qualification. */
import {build} from "esbuild";
import {readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
await build({entryPoints:[resolve(root,"fresh/family-proof-entry.ts")],
  outfile:resolve(root,"fresh/family-proof-driver.mjs"),bundle:true,
  platform:"neutral",format:"esm",target:"es2022",packages:"external",
  treeShaking:true,minifySyntax:true,legalComments:"eof",sourcemap:false,logLevel:"warning"});
// The Worker URL is relative to the emitted driver, so ship its actual
// standalone bootstrap beside it. No framework or page global is needed.
await build({entryPoints:[resolve(root,"../sdk/src/vanta/unified-bound4-bootstrap-worker.ts")],
  outfile:resolve(root,"fresh/unified-bound4-bootstrap-worker.js"),bundle:true,
  platform:"browser",format:"esm",target:"es2022",
  treeShaking:true,minifySyntax:true,legalComments:"eof",sourcemap:false,logLevel:"warning"});
// esbuild labels resolved symlink paths in source comments. Normalize only
// those non-executable labels so equivalent dependency trees produce identical bytes.
const workerPath=resolve(root,"fresh/unified-bound4-bootstrap-worker.js");
const emittedWorker=await readFile(workerPath,"utf8");
await writeFile(workerPath,emittedWorker.replace(/^\/\/ [^\r\n]*?node_modules\//gmu,"// node_modules/"));
const driver=await readFile(resolve(root,"fresh/family-proof-driver.mjs"),"utf8");
if(/proveVantaV8(?:UnifiedCombinedFeePartner|AggregateBatch|SinglePayoutAggregate)|groth16\.fullProve|MAX_PK_BYTES/u.test(driver))
  throw Error("Family distribution contains a forbidden monolithic funded path.");
const worker=await readFile(resolve(root,"fresh/unified-bound4-bootstrap-worker.js"),"utf8");
if(/^import\s/mu.test(worker))throw Error("Family bootstrap must be a standalone module worker.");
