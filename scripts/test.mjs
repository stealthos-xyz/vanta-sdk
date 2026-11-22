import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const sdk = resolve(import.meta.dirname, '../packages/vanta-sdk');
const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', 'test/*.test.mjs'], {
  cwd: sdk,
  env: {...process.env, VANTA_BUILT_SDK_ROOT: sdk},
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const types = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'test:types'], {cwd: sdk, stdio: 'inherit'});
if (types.error) throw types.error;
process.exitCode = types.status ?? 1;
