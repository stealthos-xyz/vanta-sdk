/** Build only the upstream crypto functions used by the delivered Vanta SDK.
 * No circuit, parameter, key derivation, group or proof algorithm is changed.
 */
import {readFile,writeFile,mkdir,copyFile,readdir} from "node:fs/promises";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {build,version as esbuildVersion} from "esbuild";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const output=join(root,"dist/vendor");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const circomRoot=dirname(fileURLToPath(import.meta.resolve("circomlibjs")));
const snarkRoot=dirname(fileURLToPath(import.meta.resolve("snarkjs")));
const versions={
  circomlibjs:JSON.parse(await readFile(join(circomRoot,"package.json"),"utf8")).version,
  snarkjs:JSON.parse(await readFile(join(snarkRoot,"package.json"),"utf8")).version,
  esbuild:esbuildVersion,
};
if(versions.circomlibjs!=="0.1.7"||versions.snarkjs!=="0.7.6"||versions.esbuild!=="0.25.12")
  throw Error("Review changed upstream wallet crypto versions before building this release");
await mkdir(output,{recursive:true});
const entries={
  "circom-crypto":'export {buildPoseidon} from '+JSON.stringify(join(circomRoot,"src/poseidon_wasm.js"))+';\n'+
    'export {default as buildBabyjub} from '+JSON.stringify(join(circomRoot,"src/babyjub.js"))+';\n',
};
const provenance={
  schema:"vanta-selected-upstream-crypto-v1",versions,
  execution:"Selected Poseidon and BabyJub wallet crypto only. Custody proving uses the fresh STREAM_BOUND4 runtime.",
  credentialProofs:{package:"snarkjs",version:versions.snarkjs,
    execution:"Fresh handle and partner-owner authorization import the pinned dependency directly and use singleThread:true."},
  buildRestrictions:[
    "Only buildPoseidon and buildBabyjub are bundled from circomlibjs.",
    "No generic custody prover bundle or historical bootstrap worker is built.",
  ],
  bundles:[],sources:{},
};
const upstreamPackages=new Map();
const platform="browser";
  for(const [name,contents] of Object.entries(entries)){
    const filename=name+"."+platform+".js";
    const result=await build({
      absWorkingDir:root,stdin:{contents,resolveDir:root,sourcefile:name+"-entry.js",loader:"js"},
      outfile:join(output,filename),bundle:true,platform,format:"esm",target:"es2022",
      treeShaking:true,minify:true,legalComments:"eof",metafile:true,
      banner:{js:platform==="node"
        ?'import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);'
        :'const Worker=globalThis.Worker??class {constructor(){throw Error("Wallet crypto uses a single thread");}};'},
    });
    const active=Object.values(result.metafile.outputs).flatMap(v=>Object.entries(v.inputs))
      .filter(([,data])=>data.bytesInOutput>0).map(([file])=>file.replaceAll("\\","/"));
    const forbidden=/(?:\/node_modules\/(?:bfj|jsonpath|underscore|elliptic|@ethersproject|ethers|ws)\/|^unused-node-cli:)/u;
    if(active.some(file=>forbidden.test("/"+file)))
      throw Error("Unused CLI/provider dependencies entered the delivered wallet crypto runtime");
    for(const file of Object.keys(result.metafile.inputs)){
      if(file.includes(":")&&!file.match(/^[a-z]:[\\/]/iu))continue;
      const absolute=resolve(root,file);
      if(!absolute.replaceAll("\\","/").includes("/node_modules/"))continue;
      const normalized=absolute.replaceAll("\\","/");
      const modulePath=normalized.slice(normalized.indexOf("/node_modules/")+14);
      provenance.sources[modulePath]=hash(await readFile(absolute));
      const last=normalized.lastIndexOf("/node_modules/");
      const suffix=normalized.slice(last+14).split("/");
      const count=suffix[0].startsWith("@")?2:1;
      const folder=normalized.slice(0,last+14)+suffix.slice(0,count).join("/");
      const metadata=JSON.parse(await readFile(join(folder,"package.json"),"utf8"));
      upstreamPackages.set(metadata.name+"@"+metadata.version,{folder,metadata});
    }
    const bytes=await readFile(join(output,filename));
    provenance.bundles.push({file:filename,bytes:bytes.length,sha256:hash(bytes),forbiddenActiveModules:0});
  }
const licenses=join(output,"licenses");
await mkdir(licenses,{recursive:true});
provenance.packages=[];
for(const {folder,metadata} of upstreamPackages.values()){
  const copied=[];
  const files=(await readdir(folder)).filter(file=>/^(?:COPYING(?:\.LESSER)?|LICEN[SC]E(?:\.(?:txt|md))?)$/iu.test(file));
  for(const file of files){
    const name=(metadata.name+"-"+metadata.version+"-"+file).replace(/[^a-zA-Z0-9_.-]/gu,"_");
    try{await copyFile(join(folder,file),join(licenses,name));copied.push(name);}
    catch(error){if(!["ENOENT","EISDIR"].includes(error.code))throw error;}
  }
  provenance.packages.push({name:metadata.name,version:metadata.version,license:metadata.license??null,licenseFiles:copied});
}
await writeFile(join(output,"runtime-provenance.json"),JSON.stringify(provenance,null,2)+"\n");
await writeFile(join(output,"THIRD_PARTY_NOTICES.txt"),
  "Bundled third-party source retains its upstream licenses and copyright notices.\n"+
  "circomlibjs 0.1.7: https://github.com/iden3/circomlibjs\n"+
  "Fresh credential proofs import the separately installed snarkjs 0.7.6 dependency.\n"+
  "See licenses/ and the bundled source notices. Source hashes and execution-only build restrictions are in runtime-provenance.json.\n");
console.log("Vanta selected wallet crypto built: browser-compatible bundle; no generic proving entry point");
