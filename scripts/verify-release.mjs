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
const origin = 'https://stealthos.xyz/ceremony/dogeos/kzg-live-001/api/release/artifacts/';
const pin = publication.sdkPackage;
assert.match(pin.sha256, /^[a-f0-9]{64}$/u);
assert.equal(pin.path, 'objects/' + pin.sha256 + '.tgz');
assert.ok(Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= 10 * 1024 * 1024);
const expected = await readFile(join(release, archive)).catch(async error => {
  if (error.code !== 'ENOENT') throw error;
  assert.equal(publication.artifactBaseUrl, origin);
  const response = await fetch(new URL(pin.path, origin), {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get('content-length')) <= pin.bytes);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    assert.ok(length <= pin.bytes, 'Archive exceeds signed size');
    chunks.push(chunk);
  }
  assert.equal(length, pin.bytes);
  return Buffer.concat(chunks, length);
});
assert.equal(expected.length, publication.sdkPackage.bytes);
assert.equal(createHash('sha256').update(expected).digest('hex'), publication.sdkPackage.sha256);
await using destination = await mkdtempDisposable(join(tmpdir(), 'vanta-sdk-pack-'));
if (['0.4.66','0.4.67'].includes(version)) {
  // This publication was qualified by rebuilding the pinned wrapper commit,
  // not by packing its pre-build generated browser files.
  const revision = publication.wrapperSourceCommit;
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const snapshot = join(destination.path, 'source.tar');
  const checkout = join(destination.path, 'checkout');
  await mkdir(checkout);
  execFileSync('git', ['archive', '--format=tar', '--output', snapshot, revision], {cwd: root});
  execFileSync('tar', ['-xf', snapshot, '-C', checkout]);
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run verification through npm run verify:release');
  execFileSync(process.execPath, [npm, 'ci', '--include=dev', '--no-audit', '--no-fund'], {cwd: checkout, stdio: 'inherit'});
  execFileSync(process.execPath, [npm, 'run', 'build'], {cwd: checkout, stdio: 'inherit'});
  const packed = await readFile(join(checkout, '.build', archive));
  assert.ok(packed.equals(expected), 'Signed source build differs from the signed archive');
  console.log('Verified SDK', version, 'and reproduced the signed archive. Publication digest', publicationDigest);
} else {
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
}
