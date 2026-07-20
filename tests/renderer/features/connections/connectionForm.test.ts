import { describe, expect, it } from 'vitest'
import {
  applyEngine,
  emptyDraft,
  validateDraft,
} from '@renderer/features/connections/model/connectionForm'

describe('emptyDraft', () => {
  it('postgres 기본값과 고유 id로 시작한다', () => {
    const a = emptyDraft()
    expect(a.engine).toBe('postgres')
    expect(a.port).toBe(5432)
    expect(a.tlsMode).toBe('disable')
    expect(a.aiReadOnlyUsername).toBeNull()
    expect(a.maskedColumnPatterns).toEqual([])
    // id는 호출마다 새로 만들어야 한다 — 상수면 두 새 연결이 충돌한다.
    expect(emptyDraft().id).not.toBe(a.id)
  })
})

describe('applyEngine', () => {
  it('기본 포트 상태면 새 엔진 기본 포트로 바꾼다', () => {
    const draft = { ...emptyDraft(), engine: 'postgres' as const, port: 5432 }
    expect(applyEngine(draft, 'mysql').port).toBe(3306)
  })

  it('사용자가 바꾼 포트는 덮지 않는다', () => {
    // 이 규칙이 없으면 엔진 변경이 사용자가 친 포트를 지운다.
    const draft = { ...emptyDraft(), engine: 'postgres' as const, port: 6000 }
    expect(applyEngine(draft, 'mysql').port).toBe(6000)
  })

  it('포트 없는 엔진으로 바꾸면 0이 된다', () => {
    const draft = { ...emptyDraft(), engine: 'postgres' as const, port: 5432 }
    expect(applyEngine(draft, 'sqlite').port).toBe(0)
  })
})

describe('validateDraft', () => {
  it('완전한 설정은 통과한다', () => {
    const draft = { ...emptyDraft(), name: 'prod', host: 'db.local', database: 'shop', username: 'admin' }
    expect(validateDraft(draft)).toEqual({ ok: true })
  })

  it('빈 name을 거부한다', () => {
    const draft = { ...emptyDraft(), name: '', host: 'db.local' }
    const result = validateDraft(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.name).toBeDefined()
  })

  it('51개 마스킹 패턴을 거부한다', () => {
    // 스키마 상한(50)을 재사용하는지 — 폼이 직접 규칙을 베끼지 않았는지 확인.
    const draft = {
      ...emptyDraft(),
      name: 'prod',
      maskedColumnPatterns: Array.from({ length: 51 }, (_, i) => `p${i}`),
    }
    expect(validateDraft(draft).ok).toBe(false)
  })
})
