import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const RENDERER_DIR = path.resolve('src/renderer')

/**
 * 텍스트로 그리던 아이콘들. 폰트가 그리는 대로만 그려지므로 획 굵기를 조절할 수
 * 없고, 크기 토큰이 없어 타이포 스케일을 빌려 쓰게 된다 — 앞 프로젝트에서 두 번
 * 오배정으로 이어진 결합이다. Icon 컴포넌트가 생긴 뒤로는 재도입될 이유가 없다.
 *
 * `●`은 제외한다. CSS 원(border-radius: 50%)이 아니라 비밀번호 자리표시자
 * 문자열로 쓰이고 있고, 그건 아이콘이 아니다.
 */
const GLYPHS = ['▸', '▾', '✕', '＋', '⋯', '⟳']

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full
  }
}

describe('아이콘 글리프', () => {
  it('renderer 어디에도 텍스트 글리프 아이콘이 남아 있지 않다', async () => {
    const violations: string[] = []
    for await (const file of walk(RENDERER_DIR)) {
      const source = await readFile(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        for (const g of GLYPHS) {
          if (line.includes(g)) {
            violations.push(`${path.relative(RENDERER_DIR, file)}:${i + 1} — ${g}`)
          }
        }
      })
    }
    expect(violations).toEqual([])
  })
})
