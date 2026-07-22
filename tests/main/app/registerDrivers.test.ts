import { describe, it, expect } from 'vitest'
import { DriverRegistry } from '@main/core/driver/DriverRegistry'
import { registerDrivers } from '@main/app/registerDrivers'
import { IMPLEMENTED_ENGINE_IDS } from '@shared/types/connection'

describe('registerDrivers', () => {
  it('등록된 엔진 집합이 IMPLEMENTED_ENGINE_IDS와 일치한다', () => {
    const registry = new DriverRegistry()
    registerDrivers(registry, { secrets: { get: () => Promise.resolve(null) } })
    expect([...registry.registeredEngines()].sort()).toEqual([...IMPLEMENTED_ENGINE_IDS].sort())
  })
})
