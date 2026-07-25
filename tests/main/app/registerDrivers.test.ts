import { describe, it, expect } from 'vitest'
import { DriverRegistry } from '@main/core/driver/DriverRegistry'
import { dbPasswordRefFor, registerDrivers } from '@main/app/registerDrivers'
import { IMPLEMENTED_ENGINE_IDS } from '@shared/types/connection'

describe('registerDrivers', () => {
  it('등록된 엔진 집합이 IMPLEMENTED_ENGINE_IDS와 일치한다', () => {
    const registry = new DriverRegistry()
    registerDrivers(registry, { secrets: { get: () => Promise.resolve(null) } })
    expect([...registry.registeredEngines()].sort()).toEqual([...IMPLEMENTED_ENGINE_IDS].sort())
  })

  it('AI 파생 커넥션 id는 ai-readonly 비밀을, 원 id는 db-password를 가리킨다', () => {
    expect(dbPasswordRefFor('c1')).toEqual({ kind: 'db-password', ownerId: 'c1' })
    // ownerId는 원 커넥션 id다 — renderer의 secrets:set(forAi)이 그 키로 저장한다.
    expect(dbPasswordRefFor('c1::ai')).toEqual({
      kind: 'db-password-ai-readonly',
      ownerId: 'c1',
    })
  })
})
