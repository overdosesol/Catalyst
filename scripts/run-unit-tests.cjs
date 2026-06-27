const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = join(process.cwd(), 'test');
const testFiles = readdirSync(testDir)
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => join('test', name));

if (testFiles.length === 0) {
  console.error('No unit test files found in test/*.test.mjs');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error(`Unit tests terminated by ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
