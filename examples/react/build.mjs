import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
await mkdir('public/stealthos',{recursive:true});
const options={bundle:true,format:'esm',platform:'browser',target:'es2022',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}};
await build({...options,entryPoints:[fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/worker'))],outfile:'public/stealthos/app-wallet-worker.mjs'});
await copyFile(fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/proof-worker')),'public/stealthos/unified-bound4-bootstrap-worker.js');
await build({...options,entryPoints:['src/main.jsx'],outfile:'public/app.mjs',jsx:'automatic'});
