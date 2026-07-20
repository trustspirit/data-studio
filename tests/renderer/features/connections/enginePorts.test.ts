import { describe, expect, it } from 'vitest'
import { ENGINE_IDS } from '@shared/types/connection'
import { DEFAULT_PORTS, defaultPort } from '@renderer/features/connections/model/enginePorts'

describe('DEFAULT_PORTS', () => {
  it('엔진별 표준 포트를 준다', () => {
    // 값이 틀리면 새 연결 폼이 잘못된 포트를 미리 채운다.
    expect(defaultPort('postgres')).toBe(5432)
    expect(defaultPort('mysql')).toBe(3306)
    expect(defaultPort('mariadb')).toBe(3306)
    expect(defaultPort('mongodb')).toBe(27017)
    expect(defaultPort('redis')).toBe(6379)
    expect(defaultPort('kafka')).toBe(9092)
    expect(defaultPort('rabbitmq')).toBe(5672)
  })

  it('포트가 없는 엔진은 null이다', () => {
    expect(defaultPort('sqlite')).toBeNull()
    expect(defaultPort('dynamodb')).toBeNull()
  })

  it('모든 EngineId에 항목이 있다', () => {
    // satisfies가 컴파일 타임에 잡지만, 런타임에도 표류를 막는다.
    for (const id of ENGINE_IDS) {
      expect(id in DEFAULT_PORTS).toBe(true)
    }
  })
})
