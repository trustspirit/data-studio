import { describe, it, expect } from 'vitest'
import {
  IMPLEMENTED_ENGINE_IDS,
  ENGINE_IMPLEMENTED,
  connectionConfigSchema,
} from '@shared/types/connection'

describe('ENGINE_IMPLEMENTED', () => {
  it('구현된 드라이버 5개만 true', () => {
    expect([...IMPLEMENTED_ENGINE_IDS].sort()).toEqual([
      'mariadb',
      'mongodb',
      'mysql',
      'postgres',
      'sqlite',
    ])
  })
  it('미구현 엔진은 false', () => {
    expect(ENGINE_IMPLEMENTED.redis).toBe(false)
    expect(ENGINE_IMPLEMENTED.dynamodb).toBe(false)
  })
})

describe('connectionConfigSchema.database', () => {
  const base = {
    id: 'x', name: 'n', engine: 'sqlite' as const, host: '', port: 0,
    username: '', tlsMode: 'disable' as const, aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
  it('1024자 경로 허용', () => {
    expect(connectionConfigSchema.safeParse({ ...base, database: 'a'.repeat(1024) }).success).toBe(true)
  })
  it('1025자 거부', () => {
    expect(connectionConfigSchema.safeParse({ ...base, database: 'a'.repeat(1025) }).success).toBe(false)
  })
})
