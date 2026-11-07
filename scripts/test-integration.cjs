const { spawnSync } = require('node:child_process')
const { dirname, join } = require('node:path')

// A separate gate makes missing engines a failure instead of a green, skipped suite.
const cli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const result = spawnSync(process.execPath, [cli, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, DATACON_REQUIRE_ENGINES: '1' },
})
process.exit(result.status ?? 1)
