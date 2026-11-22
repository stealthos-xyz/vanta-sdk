import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtempDisposable, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {assertSignedChikyuSdkPublication} from './sdk-publication-signature.mjs';

const root = resolve(import.meta.dirname, '..');
const sdk = join(root, 'packages/vanta-sdk');
const developmentVersion = JSON.parse(await readFile(join(sdk, 'package.json'))).version;
const published = (await readdir(join(root, 'releases'))).filter(version => /^\d+\.\d+\.\d+$/.test(version));
const version = process.argv[2] ?? published.sort((a, b) => a.localeCompare(b, 'en', {numeric: true})).at(-1);
assert.ok(published.includes(version), 'Choose a signed release in releases/');
const release = join(root, 'releases', version);
const publication = JSON.parse(await readFile(join(release, 'publication.json')));
assert.equal(publication.version, version);
const publicationDigest = assertSignedChikyuSdkPublication(publication);
const archive = 'stealthos-vanta-sdk-' + version + '.tgz';
const expected = await readFile(join(release, archive));
assert.equal(expected.length, publication.sdkPackage.bytes);
assert.equal(createHash('sha256').update(expected).digest('hex'), publication.sdkPackage.sha256);
await using destination = await mkdtempDisposable(join(tmpdir(), 'vanta-sdk-pack-'));
let source = sdk;
if (developmentVersion !== version) {
  const path = 'releases/' + version + '/publication.json';
  const revision = execFileSync('git', ['log', '-1', '--format=%H', '--', path], {cwd: root, encoding: 'utf8'}).trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const snapshot = join(destination.path, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', snapshot, revision, 'packages/vanta-sdk'], {cwd: root});
  const checkout = join(destination.path, 'checkout');
  await mkdir(checkout);
  execFileSync('tar', ['-xf', snapshot, '-C', checkout]);
  source = join(checkout, 'packages/vanta-sdk');
}
execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination.path], {cwd: source});
const packed = await readFile(join(destination.path, archive));
assert.ok(packed.equals(expected), 'Checkout package differs from the signed archive');
console.log('Verified SDK', version, 'and reproduced the signed archive. Publication digest', publicationDigest);
