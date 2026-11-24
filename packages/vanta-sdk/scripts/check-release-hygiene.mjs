import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const wording = /\b(?:todo|fixme|tbd|hack|mock(?:s|ed|ing)?|synthetic|stub(?:s|bed)?|placeholder(?:s)?|experimental|fake|demo|research|test[- ]only|dev[- ]only|pre[- ]ceremony|coming soon|not implemented)\b/iu;
const legacyName = /\b[\w$]*(?:Research|Demo|Mock|Synthetic|Placeholder|Experimental|Stub)[\w$]*\b/u;

// These literals are protocol compatibility and rejection checks, not product copy.
// Preserve them byte-for-byte in runtime code, rather than rewriting signed schemas.
export function findReleaseWording(path, source) {
  let checked = source;
  if (path === 'fresh/family-proof-driver.mjs') {
    checked = checked.replaceAll('-browser-three-proof-research-v1', '-browser-three-proof-v1');
  }
  if (path === 'fresh/family-network.mjs' || path === 'fresh/wallet-runtime.mjs') {
    checked = checked.replaceAll('!item.name.includes("research")', '!item.name.includes("reserved")');
  }
  const findings = [];
  for (const [index, line] of checked.split(/\r?\n/u).entries()) {
    const hit = line.match(wording) ?? line.match(legacyName);
    if (hit) findings.push({path, line: index + 1, term: hit[0]});
  }
  return findings;
}

export async function assertReleaseHygiene(root) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const files = pkg.files.filter(path => !path.startsWith('dist/vendor/') && /\.(?:mjs|js|mts|md)$/u.test(path));
  const findings = (await Promise.all(files.map(async path =>
    findReleaseWording(path, await readFile(resolve(root, path), 'utf8'))
  ))).flat();
  if (findings.length) throw Error('Release wording check failed:\n' +
    findings.map(({path, line, term}) => path + ':' + line + ': ' + term).join('\n'));
  return files.length;
}
