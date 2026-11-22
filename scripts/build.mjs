import {cp, mkdir, mkdtempDisposable} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join, resolve, basename} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, '.build');
await mkdir(output, {recursive: true});
await using scratch = await mkdtempDisposable(join(output, 'source-'));
const packages = join(scratch.path, 'packages');
// Keep release inputs intact while compiling editable SDK and worker sources.
await cp(join(root, 'packages'), packages, {
  recursive: true,
  filter: path => !['node_modules', '.build-src'].includes(basename(path)),
});
const sdk = join(packages, 'vanta-sdk');
for (const script of ['build.mjs', 'check-family-package.mjs']) {
  const child = spawnSync(process.execPath, [join(sdk, 'scripts', script)], {cwd: sdk, stdio: 'inherit'});
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
const pack = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--ignore-scripts', '--pack-destination', output], {
  cwd: sdk, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
if (pack.error) throw pack.error;
if (pack.status !== 0) process.exit(pack.status ?? 1);
console.log('Built candidate', join(output, JSON.parse(pack.stdout)[0].filename));
