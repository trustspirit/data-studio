import { describe, expect, it } from 'vitest'
import type { Driver } from '@main/core/driver/Driver'
import type { ReadOnlyScope, SqlCapability } from '@main/core/driver/capabilities/SqlCapability'
import type { TableInfo } from '@main/core/driver/capabilities/SchemaCapability'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { ResultSet } from '@shared/types/resultSet'

/**
 * 타입 레벨 고정 테스트.
 *
 * 이 파일이 지키는 성질들은 모든 fixture가 매번 모든 멤버를 채워 넣는
 * 일반 테스트로는 검증되지 않는다 — `explain?`/`beginReadOnly?`를 다시
 * 필수로 되돌리거나 `TableInfo.kind`를 지워도 그런 fixture들은 여전히
 * 타입체크와 테스트를 통과한다. 여기서는 "일부러 최소한만 채운" 값과
 * "일부러 빠뜨린" 값을 직접 구성해 컴파일 여부 자체를 증거로 삼는다.
 */

function baseDriverFields(): Pick<
  Driver,
  'id' | 'engine' | 'connect' | 'disconnect' | 'ping'
> {
  return {
    id: 'conn-1',
    engine: 'postgres',
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    ping: () => Promise.resolve(1),
  }
}

function emptyResultSet(): Promise<ResultSet> {
  return Promise.resolve({
    requestId: 'req-1',
    columns: [],
    rows: [],
    page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
    // `rowsAffected`는 `ResultMeta`의 **필수** 멤버다. 손으로 조립하는
    // ResultSet도 "보고하지 않음"을 명시적인 null로 적어야 한다 — 빼면
    // 여기서 컴파일이 깨진다.
    meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  })
}

describe('타입 고정: SqlCapability의 explain/beginReadOnly는 선택 멤버다', () => {
  it('execute와 classify만 있어도 SqlCapability를 구현한 것으로 컴파일된다', () => {
    // explain?: 이나 beginReadOnly?: 에서 `?`가 사라져 필수가 되면, 이
    // 객체 리터럴은 SqlCapability를 만족하지 못해 타입 에러로 컴파일이
    // 깨진다 — 즉 이 테스트 자체가 두 멤버의 선택성을 지키는 가드다.
    const minimalSql: SqlCapability = {
      execute: () => emptyResultSet(),
      classify: () => 'read',
    }

    const driver: Driver = {
      ...baseDriverFields(),
      sql: minimalSql,
    }

    expect(typeof driver.sql?.explain).toBe('undefined')
    expect(typeof driver.sql?.beginReadOnly).toBe('undefined')
    expect(driver.sql?.classify('select 1')).toBe('read')
  })

  it('driver.sql?.beginReadOnly는 if 가드 뒤에서 단언이나 !없이 호출할 수 있다', async () => {
    const scope: ReadOnlyScope = {
      execute: () => emptyResultSet(),
      end: () => Promise.resolve(),
    }

    const driver: Driver = {
      ...baseDriverFields(),
      sql: {
        execute: () => emptyResultSet(),
        classify: () => 'read',
        beginReadOnly: () => Promise.resolve(scope),
      },
    }

    const ctx: ExecutionContext = { requestId: 'req-1', signal: new AbortController().signal }

    // 단언(`as`)도, non-null(`!`)도 쓰지 않는다 — optional chaining +
    // undefined 체크만으로 좁혀져야 컴파일된다.
    if (driver.sql?.beginReadOnly !== undefined) {
      const opened = await driver.sql.beginReadOnly(ctx)
      expect(opened).toBe(scope)
    } else {
      throw new Error('이 fixture는 beginReadOnly를 제공해야 한다')
    }
  })
})

describe('타입 고정: TableInfo.kind는 필수 멤버다', () => {
  it('kind를 포함한 TableInfo 리터럴을 만들 수 있다', () => {
    const table: TableInfo = {
      schema: 'public',
      name: 'users',
      kind: 'table',
      estimatedRows: 10,
    }

    expect(table.kind).toBe('table')
  })

  it('kind를 생략하면 TableInfo 리터럴은 컴파일되지 않는다', () => {
    // @ts-expect-error kind는 필수 멤버다 — 생략하면 타입 에러가 나야 한다.
    // kind가 선택적으로 바뀌거나 인터페이스에서 삭제되면 위 줄에서 에러가
    // 나지 않게 되어 "사용되지 않는 @ts-expect-error 지시어"로 typecheck
    // 자체가 깨진다. 아래 런타임 단언은 그 상태에서도(즉 위 지시어가 어쩌다
    // 억지로 통과하는 상황에서도) kind가 실제로 없다는 사실을 한 번 더
    // 확인해, 이 테스트가 조용히 아무것도 검증하지 않게 되는 것을 막는다.
    const missingKind: TableInfo = {
      schema: 'public',
      name: 'users',
      estimatedRows: null,
    }

    expect('kind' in missingKind).toBe(false)
  })
})

describe('타입 고정: ResultMeta.rowsAffected는 필수 멤버다', () => {
  it('rowsAffected를 명시한 ResultMeta 리터럴을 만들 수 있다', () => {
    // `null`("이 엔진은 보고하지 않는다")과 `0`("실제로 0행")은 서로 다른
    // 뜻이므로 둘 다 적을 수 있어야 한다.
    const unreported: ResultSet['meta'] = {
      durationMs: 0,
      truncatedRows: false,
      truncatedBytes: false,
      rowsAffected: null,
    }
    const zeroRows: ResultSet['meta'] = {
      durationMs: 0,
      truncatedRows: false,
      truncatedBytes: false,
      rowsAffected: 0,
    }

    expect(unreported.rowsAffected).toBeNull()
    expect(zeroRows.rowsAffected).toBe(0)
  })

  it('rowsAffected를 생략하면 ResultMeta 리터럴은 컴파일되지 않는다', () => {
    // 계약(`driverContract.ts`)은 `'rowsAffected' in result.meta`를 요구하지만
    // 그건 런타임 검사라, `buildResultSet`을 거치지 않고 손으로 조립하는
    // 드라이버는 이 필드를 빼고도 타입 체크를 통과했다. `?`가 되살아나면
    // 아래 지시어가 "사용되지 않는 @ts-expect-error"가 되어 typecheck가
    // 깨진다 — 그게 이 테스트가 지키는 성질이다.
    // @ts-expect-error rowsAffected는 필수 멤버다 — 생략하면 타입 에러가 나야 한다.
    const missingRowsAffected: ResultSet['meta'] = {
      durationMs: 0,
      truncatedRows: false,
      truncatedBytes: false,
    }

    expect('rowsAffected' in missingRowsAffected).toBe(false)
  })
})
