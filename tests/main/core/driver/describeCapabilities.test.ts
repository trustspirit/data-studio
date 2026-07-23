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

    // 반환값 자체가 검증 대상이다: describeCapabilities(driver)의 결과를
    // clone해서 원본과 deep-equal한지, 그리고 모든 원소가 문자열인지 확인한다.
    // 만약 구현이 capability 객체(함수를 담고 있어 clone 불가능한 값)를
    // 목록에 그대로 흘려보내면 이 clone 자체가 던지므로, "문자열 목록만
    // 돌려준다"는 성질이 실제로 걸린다.
    const cloned = structuredClone(capabilities)

    expect(cloned).toEqual(capabilities)
    expect(capabilities.every((c) => typeof c === 'string')).toBe(true)
  })

  it('data 능력이 있으면 목록에 data를 넣는다', () => {
    const driver: Driver = {
      ...baseDriver(),
      data: {
        buildBrowse: () => ({ sql: '', params: [] }),
        applyChanges: () => {
          throw new Error('not used in this test')
        },
      },
    }

    expect(describeCapabilities(driver)).toContain('data')
  })

  it('data 능력이 없으면 넣지 않는다', () => {
    expect(describeCapabilities(baseDriver())).not.toContain('data')
  })

  it('document 능력이 있으면 목록에 document를 넣는다', () => {
    const driver: Driver = {
      ...baseDriver(),
      document: {
        listCollections: () => {
          throw new Error('not used in this test')
        },
        find: () => {
          throw new Error('not used in this test')
        },
        aggregate: () => {
          throw new Error('not used in this test')
        },
        isReadOnlyPipeline: () => true,
      },
    }

    expect(describeCapabilities(driver)).toContain('document')
  })

  it('document 능력이 없으면 넣지 않는다', () => {
    expect(describeCapabilities(baseDriver())).not.toContain('document')
  })
})
