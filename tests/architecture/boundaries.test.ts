import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const CORE_DIR = path.resolve('src/main/core')

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
    else if (entry.name.endsWith('.ts')) yield full
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
})
