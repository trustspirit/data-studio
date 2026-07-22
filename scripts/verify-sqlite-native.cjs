#!/usr/bin/env node
// SQLite 네이티브 모듈이 패키지된 Electron 앱에서 로드되는지 검증한다.
//
// arm64: 실제로 `--dir` 앱을 빌드하고 `--datacon-smoke-sqlite`로 띄워, GUI 전에
//   :memory: DB를 열어 SELECT 1이 통과하는지(센티넬 + exit 0) 확인한다 — ABI·asar
//   언팩·모듈 포함이 모두 맞물려야만 통과한다.
// x64: 크로스 빌드 앱이 산출되고 better-sqlite3 .node가 asar에서 언팩됐는지만
//   확인한다. 실행 검증은 x64 하드웨어/CI로 미룬다(문서화).
//
// 실행: `npm run verify:sqlite-native`. 실패 시 비정상 종료(CI 게이트 가능).
// macOS 전용(mac 타깃 빌드). 느리므로 `npm test`에 포함하지 않는다.

const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, readdirSync, statSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { platform } = require('node:os')

const SENTINEL = 'DATACON_SMOKE_SQLITE_OK'
const OUT = 'dist-electron'
const root = process.cwd()

function fail(msg) {
  console.error(`\n[FAIL] verify-sqlite-native: ${msg}`)
  process.exit(1)
}
function ok(msg) {
  console.log(`[OK] ${msg}`)
}

if (platform() !== 'darwin') {
  fail('macOS 전용 검증입니다(mac 타깃). 다른 플랫폼은 CI에서 별도 검증하세요.')
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root })
}

/** 앱 번들 안에서 실행 바이너리 경로를 찾는다(productName에 공백 있음). */
function appBinary(appPath) {
  const macosDir = join(appPath, 'Contents', 'MacOS')
  const bin = readdirSync(macosDir).find((n) => statSync(join(macosDir, n)).isFile())
  if (!bin) fail(`실행 바이너리를 찾지 못함: ${macosDir}`)
  return join(macosDir, bin)
}

/**
 * dist-electron/mac* 아래 모든 .app을 찾아 lipo로 아키텍처를 판별한다.
 * electron-builder는 host 아키에 따라 mac / mac-arm64 / mac-x64를 비직관적으로
 * 배정하므로, dir명이 아니라 바이너리의 실제 아키(lipo -archs)로 분류한다.
 * 반환: { arm64: <appPath|null>, x64: <appPath|null> }
 */
function discoverAppsByArch() {
  const outDir = join(root, OUT)
  const result = { arm64: null, x64: null }
  if (!existsSync(outDir)) return result
  for (const name of readdirSync(outDir)) {
    if (!name.startsWith('mac')) continue
    const dir = join(outDir, name)
    if (!statSync(dir).isDirectory()) continue
    const app = readdirSync(dir).find((n) => n.endsWith('.app'))
    if (!app) continue
    const appPath = join(dir, app)
    const archs = execFileSync('lipo', ['-archs', appBinary(appPath)], { encoding: 'utf8' }).trim()
    if (archs.includes('arm64')) result.arm64 = appPath
    if (archs.includes('x86_64')) result.x64 = appPath // 단일-슬라이스 아키 가정(universal 아님)
  }
  return result
}

/**
 * app.asar.unpacked 아래에 해당 아키의 darwin 네이티브 바이너리가 언팩돼 있고
 * 실제로 그 아키인지 lipo로 확인한다. better-sqlite3 v13은 prebuildify+N-API라
 * `prebuilds/darwin-<arch>.node`를 쓰며 런타임이 이 파일을 로드한다(win32/linux
 * 프리빌드도 함께 들어 있으니, 아키별 파일을 정확히 짚어야 false positive를 피한다).
 * @param arch 'arm64' | 'x64' (파일명). lipo 기대값은 'arm64' | 'x86_64'.
 */
function hasUnpackedDarwinNode(appPath, arch) {
  const nodeFile = join(
    appPath, 'Contents', 'Resources', 'app.asar.unpacked',
    'node_modules', 'better-sqlite3', 'prebuilds', `darwin-${arch}.node`,
  )
  if (!existsSync(nodeFile)) return false
  const want = arch === 'arm64' ? 'arm64' : 'x86_64'
  const archs = execFileSync('lipo', ['-archs', nodeFile], { encoding: 'utf8' }).trim()
  return archs.includes(want)
}

// 0) 렌더러 + main 번들 빌드(dist/) + 이전 산출물 정리(개별 호출 시 dir명 혼선 방지)
run('npm', ['run', 'build'])
rmSync(join(root, OUT), { recursive: true, force: true })

// 1) arm64 + x64를 한 번의 호출로 빌드.
//    better-sqlite3 v13은 prebuildify+N-API라 Electron ABI 재컴파일이 필요 없다 —
//    검증의 실제 관심사는 "각 아키의 올바른 prebuilds/darwin-<arch>.node가 번들·언팩
//    되고, arm64 앱에서 실제로 로드되는가"이다.
run('npx', ['electron-builder', '--dir', '--mac', '--arm64', '--x64', '--publish', 'never'])

// 2) 산출된 .app을 lipo로 아키별 분류
const apps = discoverAppsByArch()
if (apps.arm64 && apps.x64 && apps.arm64 === apps.x64) {
  fail('arm64/x64가 같은 .app으로 해석됨(universal 빌드?). 아키별 개별 슬라이스를 기대한다.')
}

// 3) arm64: 언팩 확인 + 패키지 앱을 실제로 띄워 스모크 실행(ABI·asar·포함 전부 실증)
const armApp = apps.arm64
if (!armApp) fail('arm64 앱 산출물을 찾지 못함(lipo로 arm64 슬라이스 없음).')
ok(`arm64 앱 빌드됨: ${armApp}`)
if (!hasUnpackedDarwinNode(armApp, 'arm64')) fail('arm64: darwin-arm64.node가 app.asar.unpacked에 없거나 아키 불일치.')
ok('arm64: better-sqlite3 .node가 asar에서 언팩됨')

const armBin = appBinary(armApp)
console.log(`\n$ "${armBin}" --datacon-smoke-sqlite`)
const res = spawnSync(armBin, ['--datacon-smoke-sqlite'], { encoding: 'utf8' })
const out = `${res.stdout || ''}${res.stderr || ''}`
if (res.status !== 0 || !out.includes(SENTINEL)) {
  console.error(out)
  fail(`arm64: 스모크 실패 (exit=${res.status}). ABI 불일치/로드 실패 가능 — 출력 확인.`)
}
ok('arm64: 패키지 앱에서 SQLite 로드 + SELECT 1 성공 (센티넬 확인)')

// 4) x64: 크로스 빌드 산출(x86_64 슬라이스) + 언팩 확인(실행 검증은 x64 HW/CI로 미룸)
const x64App = apps.x64
if (!x64App) fail('x64 앱 산출물을 찾지 못함(lipo로 x86_64 슬라이스 없음).')
ok(`x64 앱 빌드됨: ${x64App}`)
if (!hasUnpackedDarwinNode(x64App, 'x64')) fail('x64: darwin-x64.node가 app.asar.unpacked에 없거나 아키 불일치.')
ok('x64: better-sqlite3 .node가 asar에서 언팩됨 (실행 검증은 x64 HW/CI로 미룸)')

console.log('\n[DONE] verify-sqlite-native: arm64 실증 통과, x64 빌드 산출 확인 완료.')
