import { describe, expect, it, vi } from 'vitest'
import { DriverRegistry, UnsupportedEngineError } from '@main/core/driver/DriverRegistry'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'

const CONFIG: ConnectionConfig = {
  id: 'conn-1',
  name: 'Local',
  engine: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'app',
  username: 'dev',
  tlsMode: 'disable',
  aiReadOnlyUsername: null,
  maskedColumnPatterns: [],
}

function fakeDriver(config: ConnectionConfig): Driver {
  return {
    id: config.id,
    engine: config.engine,
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    ping: () => Promise.resolve(1),
  }
}

describe('DriverRegistry', () => {
  it('등록한 엔진의 드라이버를 만든다', () => {
    const registry = new DriverRegistry()
    registry.register('postgres', fakeDriver)

    const driver = registry.create(CONFIG)

    expect(driver.engine).toBe('postgres')
    expect(driver.id).toBe('conn-1')
  })

  it('팩토리에 설정을 그대로 넘긴다', () => {
    const registry = new DriverRegistry()
    const factory = vi.fn(fakeDriver)
    registry.register('postgres', factory)

    registry.create(CONFIG)

    expect(factory).toHaveBeenCalledWith(CONFIG)
  })

  it('등록되지 않은 엔진은 UnsupportedEngineError로 거부한다', () => {
    const registry = new DriverRegistry()

    expect(() => registry.create(CONFIG)).toThrow(UnsupportedEngineError)
  })

  it('오류에 어떤 엔진이 문제인지 담는다', () => {
    const registry = new DriverRegistry()

    expect(() => registry.create(CONFIG)).toThrow(/postgres/)
  })

  it('같은 엔진을 두 번 등록하면 거부한다', () => {
    const registry = new DriverRegistry()
    registry.register('postgres', fakeDriver)

    // 조용히 덮어쓰면 어느 드라이버가 도는지 알 수 없게 된다.
    expect(() => registry.register('postgres', fakeDriver)).toThrow(/postgres/)
  })

  it('지원 여부를 물어볼 수 있다', () => {
    const registry = new DriverRegistry()
    registry.register('postgres', fakeDriver)

    expect(registry.supports('postgres')).toBe(true)
    expect(registry.supports('mysql')).toBe(false)
  })

  it('등록된 엔진 목록을 준다', () => {
    const registry = new DriverRegistry()
    registry.register('postgres', fakeDriver)
    registry.register('sqlite', fakeDriver)

    expect([...registry.registeredEngines()].sort()).toEqual(['postgres', 'sqlite'])
  })

  it('레지스트리 인스턴스끼리 상태를 공유하지 않는다', () => {
    const a = new DriverRegistry()
    const b = new DriverRegistry()
    a.register('postgres', fakeDriver)

    expect(b.supports('postgres')).toBe(false)
  })
})
