import {copyFile, mkdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const target = resolve('public/stealthos');
const walletWorker = fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/browser/worker'));
const driver = fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/family-proof-driver'));
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
await copyFile(join(dirname(driver), 'unified-bound4-bootstrap-worker.js'), join(target, 'unified-bound4-bootstrap-worker.js'));
