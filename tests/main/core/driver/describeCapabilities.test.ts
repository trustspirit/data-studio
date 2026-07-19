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

  it('schema 객체만 있으면 schema만 보고한다', () => {
    const driver: Driver = {
      ...baseDriver(),
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

    expect(describeCapabilities(driver)).toEqual(['schema'])
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

  it('채워진 보고 결과는 IPC를 건널 수 있는 문자열 배열이다', () => {
    // 빈 배열을 clone하는 테스트는 describeCapabilities가 `return []`으로
    // 뭉개져도 통과한다 — Capability가 문자열 union이라 타입상으로는 항상
    // clone-safe하기 때문이다. 실제로 걸려 있는 건 "함수를 담은 capability
    // 객체 자체는 clone되면 안 되고, 거기서 파생한 문자열 목록만 clone돼야
    // 한다"는 동작이므로, sql/schema가 모두 채워진 driver로 검증한다.
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

    const capabilities = describeCapabilities(driver)

    expect(capabilities).toEqual(['sql', 'schema'])
    expect(structuredClone(capabilities)).toEqual(capabilities)
    // capability 객체 자체는 함수를 담고 있어 IPC(structuredClone)를 건널 수
    // 없다 — 이것이 describeCapabilities가 문자열 목록으로 옮겨 담는 이유다.
    expect(() => structuredClone(driver.sql)).toThrow()
  })
})
