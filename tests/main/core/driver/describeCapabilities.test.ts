import { describe, expect, it } from 'vitest'
import { describeCapabilities } from '@main/core/driver/describeCapabilities'
import type { Driver } from '@main/core/driver/Driver'

function baseDriver(): Driver {
  return {
    id: 'conn-1',
    engine: 'postgres',
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    ping: () => Promise.resolve(1),
  }
}

describe('describeCapabilities', () => {
  it('아무 능력도 없으면 빈 목록을 준다', () => {
    expect(describeCapabilities(baseDriver())).toEqual([])
  })

  it('sql 객체가 있으면 sql을 보고한다', () => {
    const driver: Driver = {
      ...baseDriver(),
      sql: {
        execute: () => {
          throw new Error('not used in this test')
        },
        explain: () => {
          throw new Error('not used in this test')
        },
        beginReadOnly: () => {
          throw new Error('not used in this test')
        },
        classify: () => 'read',
      },
    }

    expect(describeCapabilities(driver)).toEqual(['sql'])
  })

  it('여러 능력을 안정된 순서로 보고한다', () => {
    const driver: Driver = {
      ...baseDriver(),
      sql: {
        execute: () => {
          throw new Error('not used in this test')
        },
        explain: () => {
          throw new Error('not used in this test')
        },
        beginReadOnly: () => {
          throw new Error('not used in this test')
        },
        classify: () => 'read',
      },
      schema: {
        listSchemas: () => {
          throw new Error('not used in this test')
        },
        listTables: () => {
          throw new Error('not used in this test')
        },
        describeTable: () => {
          throw new Error('not used in this test')
        },
        listIndexes: () => {
          throw new Error('not used in this test')
        },
        listForeignKeys: () => {
          throw new Error('not used in this test')
        },
      },
    }

    expect(describeCapabilities(driver)).toEqual(['sql', 'schema'])
  })

  it('보고 결과는 IPC를 건널 수 있는 문자열 배열이다', () => {
    const capabilities = describeCapabilities(baseDriver())

    expect(structuredClone(capabilities)).toEqual(capabilities)
  })
})
