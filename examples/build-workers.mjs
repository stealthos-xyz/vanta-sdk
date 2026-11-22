import {copyFile, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const target = resolve('public/stealthos');
const walletWorker = fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/worker'));
const proofWorker = fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/proof-worker'));
await mkdir(target, {recursive: true});
await build({
  entryPoints: [walletWorker],
  outfile: join(target, 'app-wallet-worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'},
});
await copyFile(proofWorker, join(target, 'unified-bound4-bootstrap-worker.js'));
