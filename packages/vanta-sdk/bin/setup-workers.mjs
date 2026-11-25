#!/usr/bin/env node
import {copyFile,mkdir,mkdtemp,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){console.log('Usage: vanta-setup-workers [output-directory]');process.exit(0);}
if(args.length>1||args.some(a=>a.startsWith('-')))throw Error('Usage: vanta-setup-workers [output-directory]');
const target=resolve(args[0]??'public/stealthos');
let build;
try{({build}=await import('esbuild'));}catch{throw Error('Install esbuild in the consumer project with npm install -D esbuild.');}
await mkdir(target,{recursive:true});
const scratch=await mkdtemp(join(target,'.vanta-workers-'));
try{
 await build({entryPoints:[fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/worker'))],
  outfile:join(scratch,'app-wallet-worker.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',
  define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
 await copyFile(fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/proof-worker')),join(scratch,'unified-bound4-bootstrap-worker.js'));
 for(const name of ['unified-bound4-bootstrap-worker.js','app-wallet-worker.mjs'])await rename(join(scratch,name),join(target,name));
 console.log('Vanta workers built in '+target);
}finally{await rm(scratch,{recursive:true,force:true});}
