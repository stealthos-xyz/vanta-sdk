import {copyFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const workerDir = join(publicDir, 'stealthos');
await mkdir(workerDir, {recursive: true});
const options = {
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'},
};
await build({...options, entryPoints: [join(root, 'src/main.mjs')], outfile: join(publicDir, 'app.mjs')});
await build({...options, entryPoints: [fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/worker'))],
  outfile: join(workerDir, 'app-wallet-worker.mjs')});
await copyFile(fileURLToPath(import.meta.resolve('@stealthos/vanta-sdk/proof-worker')),
  join(workerDir, 'unified-bound4-bootstrap-worker.js'));
