import {build} from 'esbuild';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
for(const name of ['app-wallet','encrypted-store'])await build({entryPoints:[resolve(root,'browser/'+name+'.ts')],
 outfile:resolve(root,'browser/'+name+'.mjs'),bundle:true,packages:'external',platform:'browser',format:'esm',target:'es2022',logLevel:'warning'});
await build({entryPoints:[resolve(root,'browser/app-wallet-worker.ts')],outfile:resolve(root,'browser/app-wallet-worker.mjs'),
 bundle:true,packages:'external',platform:'browser',format:'esm',target:'es2022',conditions:['browser'],logLevel:'warning'});
