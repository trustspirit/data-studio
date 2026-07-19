import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const CORE_DIR = path.resolve('src/main/core')
const RENDERER_DIR = path.resolve('src/renderer')
const SRC_DIR = path.resolve('src')

// 바깥 계층 디렉토리 이름. core는 이 디렉토리들을 어떤 형태로도 import할 수 없다:
//   - 상대 경로, 어떤 깊이든: '../infrastructure', '../../../infrastructure/x' 등
//   - 별칭 경로: '@main/infrastructure', '@main/infrastructure/x'
const FORBIDDEN_LAYER_SEGMENTS = ['infrastructure', 'drivers', 'ipc', 'security']

// import/export의 정적 specifier(`from '...'`, `from "..."`)와
// 동적 import(`import('...')`), CommonJS `require('...')`를 모두 잡는다.
// `from`과 따옴표 사이의 공백은 optional이다 (`from"electron"`도 유효한 JS이기 때문).
const SPECIFIER_PATTERN = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

function violatedLayer(specifier: string): string | null {
  if (specifier === 'electron' || specifier.startsWith('electron/')) {
    return 'electron'
  }

  for (const segment of FORBIDDEN_LAYER_SEGMENTS) {
    const relativeEscape = new RegExp(`^(\\.\\./)+${segment}(/|$)`)
    const aliasEscape = new RegExp(`^@main/${segment}(/|$)`)
    if (relativeEscape.test(specifier) || aliasEscape.test(specifier)) {
      return segment
    }
  }

  return null
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full
  }
}

describe('의존성 경계', () => {
  it('core는 바깥 계층이나 electron을 import하지 않는다', async () => {
    const violations: string[] = []

    for await (const file of walk(CORE_DIR)) {
      const source = await readFile(file, 'utf8')
      const imports = [...source.matchAll(SPECIFIER_PATTERN)].map((m) => m[1] ?? '')

      for (const specifier of imports) {
        const violated = violatedLayer(specifier)
        if (violated !== null) {
          violations.push(`${path.relative(process.cwd(), file)} → ${specifier} (${violated})`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('renderer는 main 프로세스 코드를 import하지 않는다', async () => {
    // renderer 번들은 신뢰되지 않는 곳에서 실행된다. main 프로세스 모듈이
    // 여기로 딸려 들어가면 커넥션 처리·비밀 취급 코드가 renderer 번들에
    // 실려 나간다.
    const violations: string[] = []

    for await (const file of walk(RENDERER_DIR)) {
      const source = await readFile(file, 'utf8')

      for (const match of source.matchAll(SPECIFIER_PATTERN)) {
        const specifier = match[1] ?? ''
        const reachesMain =
          /^@main(\/|$)/.test(specifier) || /^(\.\.\/)+main(\/|$)/.test(specifier)

        if (reachesMain) {
          violations.push(`${path.relative(process.cwd(), file)} → ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('renderer가 고른 URL을 OS 브라우저로 넘기는 코드가 없다', async () => {
    // shell.openExternal에 renderer 출처 URL을 넘기면 그 자체가 유출 통로가
    // 된다 — CSP는 window.open을 덮지 못한다. 되살아나는 것을 막는 가드다.
    // 나중에 정당한 필요가 생기면 호스트 허용목록과 사용자 확인을 붙이고
    // 이 테스트를 그 조건에 맞게 고쳐야 한다.
    const violations: string[] = []

    for await (const file of walk(SRC_DIR)) {
      const source = await readFile(file, 'utf8')
      if (/openExternal/.test(source)) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })
})
