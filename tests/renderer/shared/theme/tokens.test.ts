import { describe, expect, it } from 'vitest'
import { darkTheme } from '@renderer/shared/theme'

/** #rrggbb → (R+G+B)/3. 스펙 §1.1이 진단에 쓴 것과 같은 척도다. */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r + g + b) / 3
}

describe('디자인 토큰 불변식', () => {
  it('표면 4단이 단조 증가하고 간격이 8 이상이다', () => {
    const s = darkTheme.color.surface
    const ladder = [s.bg, s.base, s.panel, s.raised].map(luminance)
    for (let i = 0; i < ladder.length - 1; i += 1) {
      const gap = (ladder[i + 1] ?? 0) - (ladder[i] ?? 0)
      expect(gap).toBeGreaterThanOrEqual(8)
    }
  })

  it('표면 전체 폭이 명도 30 이상이다 — 5.2% 밴드 재발 방지', () => {
    const s = darkTheme.color.surface
    expect(luminance(s.raised) - luminance(s.bg)).toBeGreaterThanOrEqual(30)
  })

  it('폰트 4단이 단조 증가하고 최대·최소 비가 1.7 이상이다', () => {
    const f = darkTheme.fontSize
    const px = [f.label, f.body, f.heading, f.title].map((v) => parseInt(v, 10))
    for (let i = 0; i < px.length - 1; i += 1) {
      expect(px[i + 1] ?? 0).toBeGreaterThan(px[i] ?? 0)
    }
    expect((px[3] ?? 0) / (px[0] ?? 1)).toBeGreaterThanOrEqual(1.7)
  })

  it('의미색이 정확히 넷이다 — 다섯 번째가 조용히 늘지 않게', () => {
    const semantic = Object.keys(darkTheme.color.intent).filter((k) => !k.startsWith('on'))
    expect(semantic.sort()).toEqual(['accent', 'danger', 'success', 'warning'])
  })

  it('행 상태 색이 표면 계단과 겹치지 않는다', () => {
    // selected는 알파 틴트여야 한다. 불투명 hex면 표면 계단과 경쟁한다.
    expect(darkTheme.color.row.selected).toMatch(/^rgba\(/)
  })

  it('어떤 row.* 값도 어떤 surface.* 값과 같지 않다', () => {
    // 계단만 지키면 충분하지 않다. row.hover가 surface.base와 바이트 단위로
    // 같아지면 사이드바 위 행의 hover·활성 표시가 통째로 사라진다.
    const surfaces = new Set<string>(Object.values(darkTheme.color.surface))
    const collisions = Object.entries(darkTheme.color.row).filter(([, v]) => surfaces.has(v))
    expect(collisions).toEqual([])
  })

  it('hover·selected는 알파 틴트다 — 어느 표면 위에서든 한 단 들어올린다', () => {
    // staged·line은 특정 표면 위에만 놓이는 면/선이라 불투명이어도 된다.
    // 컨테이너를 가리지 않고 "들어올려야" 하는 것은 hover와 selected뿐이다.
    expect(darkTheme.color.row.hover).toMatch(/^rgba\(/)
    expect(darkTheme.color.row.selected).toMatch(/^rgba\(/)
  })
})
