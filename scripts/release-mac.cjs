const { spawnSync } = require('node:child_process')
const { dirname, join } = require('node:path')

const required = ['CSC_NAME', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
const missing = required.filter((key) => !process.env[key])
if (process.platform !== 'darwin' || missing.length > 0) {
  console.error('Signed macOS release requires macOS, an installed Developer ID certificate, and: ' + required.join(', '))
  console.error('Missing configuration: ' + missing.join(', '))
  process.exit(1)
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const build = spawnSync(npm, ['run', 'release:check'], { stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)
const cli = join(dirname(require.resolve('electron-builder/package.json')), 'cli.js')
const result = spawnSync(process.execPath, [cli, '--config', 'electron-builder.release.yml', '--mac', '--publish', 'never'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
