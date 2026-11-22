import {build} from "esbuild";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
await build({entryPoints:[resolve(root,"fresh/wallet-entry.ts")],
  outfile:resolve(root,"fresh/wallet-runtime.mjs"),bundle:true,
  platform:"neutral",format:"esm",target:"es2022",packages:"external",
  legalComments:"none",sourcemap:false,logLevel:"warning",
  plugins:[{name:"selected-circom-crypto",setup(api){
    api.onResolve({filter:/^#vanta-/},args=>({path:args.path,external:true}));
    api.onResolve({filter:/^circomlibjs$/},()=>({
      path:"#vanta-circom-crypto",external:true,
    }));
  }}],
});
