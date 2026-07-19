import { describe, expect, it } from 'vitest'
import { createMemoryDriver, type MemorySeed } from '@main/drivers/memory/MemoryDriver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { PageRequest } from '@shared/types/resultSet'
import type { ConnectionConfig } from '@shared/types/connection'
import { describeDriverContract } from '../../contract/driverContract'

const CONFIG: ConnectionConfig = {
  id: 'mem-1',
  name: 'Memory',
  engine: 'sqlite',
  host: '',
  port: 0,
  database: ':memory:',
  username: '',
  tlsMode: 'disable',
  aiReadOnlyUsername: null,
  maskedColumnPatterns: [],
}

function ctx(requestId = 'req-1'): ExecutionContext {
  return { requestId, signal: new AbortController().signal }
}

const PAGE: PageRequest = { cursor: null, maxRows: 100, maxBytes: 1_000_000 }

function must<T>(value: T | undefined | null, message: string): T {
  if (value === null || value === undefined) throw new Error(message)
  return value
}

function seedWithUsers(): MemorySeed {
  return {
    tables: [
      {
        schema: 'public',
        name: 'users',
        columns: [
          { name: 'id', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
          { name: 'email', type: 'text', nullable: true, defaultValue: null, isPrimaryKey: false },
        ],
        rows: [
          [1, 'a@x.com'],
          [2, null],
        ],
      },
    ],
  }
}

describeDriverContract('MemoryDriver', () => ({
  driver: createMemoryDriver(CONFIG),
  config: CONFIG,
  read: {
    statement: 'SELECT * FROM public.contract_probe',
    expectedRowCount: 3,
    // 이름은 같고 스키마가 다른 테이블. 커서 신원에 스키마가 빠져 있으면
    // 여기서 커서가 그대로 먹혀 계약이 빨개진다.
    foreignStatement: 'SELECT * FROM analytics.contract_probe',
  },
  write: { statement: 'DELETE FROM public.contract_probe', expectedRowsAffected: 3 },
}))

describe('MemoryDriver 고유 동작', () => {
  it('시드로 넣은 테이블만 스키마로 노출한다', async () => {
    const driver = createMemoryDriver(CONFIG, {
      tables: [
        {
          schema: 'public',
          name: 'users',
          columns: [
            { name: 'id', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
          ],
          rows: [[1]],
        },
        {
          schema: 'public',
          name: 'orders',
          kind: 'view',
          columns: [
            { name: 'id', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
          ],
          rows: [[1]],
        },
        {
          schema: 'other',
          name: 'elsewhere',
          columns: [
            { name: 'id', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
          ],
          rows: [[1]],
        },
      ],
    })
    const schema = must(driver.schema, 'memory driver must expose schema')

    expect((await schema.listSchemas(ctx())).map((s) => s.name)).toEqual(['public', 'other'])
    expect((await schema.listTables(ctx(), 'public')).map((t) => t.name)).toEqual([
      'users',
      'orders',
    ])
    expect((await schema.listTables(ctx(), 'other')).map((t) => t.name)).toEqual(['elsewhere'])
  })

  it('시드가 준 kind와 행 수를 그대로 보고한다', async () => {
    const driver = createMemoryDriver(CONFIG, {
      tables: [
        {
          schema: 'public',
          name: 'v_orders',
          kind: 'materialized_view',
          columns: [
            { name: 'id', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
          ],
          rows: [[1], [2], [3]],
        },
      ],
    })
    const schema = must(driver.schema, 'memory driver must expose schema')
    const table = must((await schema.listTables(ctx(), 'public'))[0], 'expected one table')

    expect(table.kind).toBe('materialized_view')
    expect(table.estimatedRows).toBe(3)
  })

  it('kind를 생략한 시드 테이블은 table로 본다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const schema = must(driver.schema, 'memory driver must expose schema')
    const table = must((await schema.listTables(ctx(), 'public'))[0], 'expected one table')

    expect(table.kind).toBe('table')
  })

  it('시드의 인덱스와 외래키를 그대로 돌려준다', async () => {
    const driver = createMemoryDriver(CONFIG, {
      tables: [
        {
          schema: 'public',
          name: 'orders',
          columns: [
            { name: 'id', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
          ],
          rows: [[1]],
          indexes: [{ name: 'orders_pkey', columns: ['id'], unique: true, sizeBytes: 4096 }],
          foreignKeys: [
            {
              name: 'orders_user_fk',
              columns: ['user_id'],
              referencedSchema: 'public',
              referencedTable: 'users',
              referencedColumns: ['id'],
            },
          ],
        },
      ],
    })
    const schema = must(driver.schema, 'memory driver must expose schema')

    expect((await schema.listIndexes(ctx(), 'public', 'orders')).map((i) => i.name)).toEqual([
      'orders_pkey',
    ])
    expect((await schema.listForeignKeys(ctx(), 'public', 'orders')).map((f) => f.name)).toEqual([
      'orders_user_fk',
    ])
    // 다른 테이블의 인덱스를 흘려주지 않는다.
    expect(await schema.listIndexes(ctx(), 'public', 'nope')).toEqual([])
  })

  it('시드 행을 WireValue로 정규화해 돌려준다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')

    const result = await sql.execute(ctx(), 'SELECT * FROM users', PAGE)

    expect(result.columns).toEqual([
      { name: 'id', type: 'int8' },
      { name: 'email', type: 'text' },
    ])
    expect(result.rows).toEqual([
      [
        { t: 'int', v: 1 },
        { t: 'str', v: 'a@x.com' },
      ],
      [{ t: 'int', v: 2 }, { t: 'null' }],
    ])
    expect(result.page.cursor).toBeNull()
    expect(result.page.hasMore).toBe(false)
    expect(result.meta.rowsAffected).toBeNull()
  })

  it('여러 JS 타입을 대응하는 WireValue 태그로 옮긴다', async () => {
    const driver = createMemoryDriver(CONFIG, {
      tables: [
        {
          schema: 'public',
          name: 'mixed',
          columns: [
            { name: 'b', type: 'bool', nullable: false, defaultValue: null, isPrimaryKey: false },
            { name: 'i', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: false },
            { name: 'f', type: 'float8', nullable: false, defaultValue: null, isPrimaryKey: false },
            { name: 'g', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: false },
            { name: 'd', type: 'timestamptz', nullable: false, defaultValue: null, isPrimaryKey: false },
            { name: 'j', type: 'jsonb', nullable: false, defaultValue: null, isPrimaryKey: false },
          ],
          rows: [[true, 7, 1.5, 9007199254740993n, new Date('2024-01-02T03:04:05.000Z'), { a: 1 }]],
        },
      ],
    })
    const sql = must(driver.sql, 'memory driver must expose sql')

    const result = await sql.execute(ctx(), 'SELECT * FROM mixed', PAGE)

    expect(result.rows).toEqual([
      [
        { t: 'bool', v: true },
        { t: 'int', v: 7 },
        { t: 'float', v: 1.5 },
        { t: 'bigint', v: '9007199254740993' },
        { t: 'date', v: '2024-01-02T03:04:05.000Z' },
        { t: 'json', v: '{"a":1}', truncated: false },
      ],
    ])
  })

  it('스키마 한정 이름과 따옴표 붙은 이름 모두에서 테이블을 찾는다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')

    const qualified = await sql.execute(ctx(), 'SELECT * FROM public."users"', PAGE)

    expect(qualified.rows).toHaveLength(2)
  })

  /** 이름이 같고 스키마만 다른 두 테이블. 스키마 한정자가 실제로 고르는지 본다. */
  function twoSchemaSeed(): MemorySeed {
    return {
      tables: [
        {
          schema: 'public',
          name: 'users',
          columns: [
            { name: 'a', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
          ],
          rows: [[1], [2]],
        },
        {
          schema: 'analytics',
          name: 'users',
          columns: [
            { name: 'b', type: 'text', nullable: false, defaultValue: null, isPrimaryKey: true },
          ],
          rows: [['x']],
        },
      ],
    }
  }

  it('스키마 한정자가 같은 이름의 테이블 중 어느 쪽인지를 실제로 고른다', async () => {
    const driver = createMemoryDriver(CONFIG, twoSchemaSeed())
    const sql = must(driver.sql, 'memory driver must expose sql')

    const fromPublic = await sql.execute(ctx(), 'SELECT * FROM public.users', PAGE)
    const fromAnalytics = await sql.execute(ctx(), 'SELECT * FROM analytics.users', PAGE)

    expect(fromPublic.columns).toEqual([{ name: 'a', type: 'int8' }])
    expect(fromPublic.rows).toEqual([[{ t: 'int', v: 1 }], [{ t: 'int', v: 2 }]])

    expect(fromAnalytics.columns).toEqual([{ name: 'b', type: 'text' }])
    expect(fromAnalytics.rows).toEqual([[{ t: 'str', v: 'x' }]])
  })

  it('스키마별로 describeTable이 서로 다른 컬럼을 돌려준다', async () => {
    const driver = createMemoryDriver(CONFIG, twoSchemaSeed())
    const schema = must(driver.schema, 'memory driver must expose schema')

    expect((await schema.describeTable(ctx(), 'public', 'users')).columns.map((c) => c.name)).toEqual(
      ['a'],
    )
    expect(
      (await schema.describeTable(ctx(), 'analytics', 'users')).columns.map((c) => c.name),
    ).toEqual(['b'])
    await expect(schema.describeTable(ctx(), 'nope', 'users')).rejects.toThrow(/unknown table/i)
  })

  it('한정자가 없는데 이름이 여러 스키마에 있으면 아무거나 고르지 않고 던진다', async () => {
    const driver = createMemoryDriver(CONFIG, twoSchemaSeed())
    const sql = must(driver.sql, 'memory driver must expose sql')

    await expect(sql.execute(ctx(), 'SELECT * FROM users', PAGE)).rejects.toThrow(/ambiguous/i)
  })

  it('한 스키마에서 얻은 커서를 같은 이름의 다른 스키마 테이블에 쓸 수 없다', async () => {
    // 커서 신원이 테이블 이름뿐이면 이 커서가 그대로 먹혀서, 거부되어야 할
    // 요청이 조용히 엉뚱한 스키마의 행을 돌려준다.
    const driver = createMemoryDriver(CONFIG, twoSchemaSeed())
    const sql = must(driver.sql, 'memory driver must expose sql')

    const fromPublic = await sql.execute(ctx(), 'SELECT * FROM public.users', {
      cursor: null,
      maxRows: 1,
      maxBytes: 1_000_000,
    })
    const cursor = must(fromPublic.page.cursor, 'expected a cursor')

    await expect(
      sql.execute(ctx(), 'SELECT * FROM analytics.users', {
        cursor,
        maxRows: 1,
        maxBytes: 1_000_000,
      }),
    ).rejects.toThrow(/cursor belongs to table/i)
  })

  it('페이지 상한을 결과에 적용하고 커서로 이어 읽게 한다', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => [i])
    const driver = createMemoryDriver(CONFIG, {
      tables: [
        {
          schema: 'public',
          name: 'nums',
          columns: [
            { name: 'n', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: false },
          ],
          rows,
        },
      ],
    })
    const sql = must(driver.sql, 'memory driver must expose sql')

    const first = await sql.execute(ctx(), 'SELECT * FROM nums', {
      cursor: null,
      maxRows: 3,
      maxBytes: 1_000_000,
    })

    expect(first.rows).toHaveLength(3)
    expect(first.rows).toEqual([
      [{ t: 'int', v: 0 }],
      [{ t: 'int', v: 1 }],
      [{ t: 'int', v: 2 }],
    ])
    expect(first.meta.truncatedRows).toBe(true)
    expect(first.page.hasMore).toBe(true)

    const second = await sql.execute(ctx(), 'SELECT * FROM nums', {
      cursor: must(first.page.cursor, 'expected a cursor'),
      maxRows: 3,
      maxBytes: 1_000_000,
    })

    expect(second.rows).toEqual([
      [{ t: 'int', v: 3 }],
      [{ t: 'int', v: 4 }],
      [{ t: 'int', v: 5 }],
    ])
  })

  it('byte 상한이 행 수 상한보다 먼저 걸린다', async () => {
    const wide = 'x'.repeat(500)
    const driver = createMemoryDriver(CONFIG, {
      tables: [
        {
          schema: 'public',
          name: 'wide',
          columns: [
            { name: 's', type: 'text', nullable: false, defaultValue: null, isPrimaryKey: false },
          ],
          rows: [[wide], [wide], [wide], [wide]],
        },
      ],
    })
    const sql = must(driver.sql, 'memory driver must expose sql')

    const page = await sql.execute(ctx(), 'SELECT * FROM wide', {
      cursor: null,
      maxRows: 100,
      maxBytes: 1200,
    })

    expect(page.rows.length).toBeLessThan(4)
    expect(page.meta.truncatedBytes).toBe(true)
    // 잘려나간 행이 있으므로 커서는 반드시 "돌려준 마지막 행 다음"을 가리켜야 한다.
    expect(page.page.cursor).not.toBeNull()
    expect(page.page.hasMore).toBe(true)
  })

  it('다른 테이블에서 얻은 커서는 거부한다', async () => {
    const driver = createMemoryDriver(CONFIG, {
      tables: [
        {
          schema: 'public',
          name: 'a',
          columns: [
            { name: 'n', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: false },
          ],
          rows: [[1], [2]],
        },
        {
          schema: 'public',
          name: 'b',
          columns: [
            { name: 'n', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: false },
          ],
          rows: [[1], [2]],
        },
      ],
    })
    const sql = must(driver.sql, 'memory driver must expose sql')

    const fromA = await sql.execute(ctx(), 'SELECT * FROM a', {
      cursor: null,
      maxRows: 1,
      maxBytes: 1_000_000,
    })
    const cursor = must(fromA.page.cursor, 'expected a cursor')

    await expect(
      sql.execute(ctx(), 'SELECT * FROM b', { cursor, maxRows: 1, maxBytes: 1_000_000 }),
    ).rejects.toThrow(/cursor/i)
  })

  it('형식이 잘못된 커서는 거부한다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')

    await expect(
      sql.execute(ctx(), 'SELECT * FROM users', {
        cursor: 'not-a-cursor',
        maxRows: 1,
        maxBytes: 1_000_000,
      }),
    ).rejects.toThrow(/cursor/i)
  })

  it('FROM 절이 없는 문장은 빈 결과가 된다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')

    const result = await sql.execute(ctx(), 'SELECT 1', PAGE)

    expect(result.rows).toEqual([])
    expect(result.columns).toEqual([])
    expect(result.page.hasMore).toBe(false)
  })

  it('알 수 없는 테이블 조회는 던진다', async () => {
    const driver = createMemoryDriver(CONFIG)
    const sql = must(driver.sql, 'memory driver must expose sql')

    await expect(sql.execute(ctx(), 'SELECT * FROM nope', PAGE)).rejects.toThrow(/nope/)
  })

  it('DELETE가 행을 실제로 지우고 rowsAffected로 보고한다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')

    const deleted = await sql.execute(ctx(), 'DELETE FROM users', PAGE)

    expect(deleted.meta.rowsAffected).toBe(2)
    expect(deleted.rows).toEqual([])

    // 두 번째 DELETE는 "실제로 0행"이다 — null(보고 안 함)과 다른 값이어야 한다.
    const again = await sql.execute(ctx(), 'DELETE FROM users', PAGE)
    expect(again.meta.rowsAffected).toBe(0)

    const after = await sql.execute(ctx(), 'SELECT * FROM users', PAGE)
    expect(after.rows).toEqual([])
  })

  it('지원하지 않는 쓰기 문장은 조용히 성공하지 않고 던진다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')

    await expect(sql.execute(ctx(), 'UPDATE users SET email = NULL', PAGE)).rejects.toThrow(
      /unsupported/i,
    )
  })

  it('읽기 전용 범위 밖에서는 DELETE가 통과한다', async () => {
    // 읽기 전용 계약이 "메모리 드라이버가 원래 쓰기를 못해서" 통과하는 게
    // 아님을 못 박는다 — 범위 안에서만 거부되어야 한다.
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')
    if (sql.beginReadOnly === undefined) throw new Error('memory driver must support beginReadOnly')

    const scope = await sql.beginReadOnly(ctx())
    await expect(scope.execute(ctx(), 'DELETE FROM users', PAGE)).rejects.toThrow(/read-only/i)
    await scope.end()

    const outside = await sql.execute(ctx(), 'DELETE FROM users', PAGE)
    expect(outside.meta.rowsAffected).toBe(2)
  })

  it('읽기 전용 범위는 unknown 분류 문장도 거부한다', async () => {
    const driver = createMemoryDriver(CONFIG, seedWithUsers())
    const sql = must(driver.sql, 'memory driver must expose sql')
    if (sql.beginReadOnly === undefined) throw new Error('memory driver must support beginReadOnly')
    const scope = await sql.beginReadOnly(ctx())

    expect(sql.classify('CALL some_procedure()')).toBe('unknown')
    await expect(scope.execute(ctx(), 'CALL some_procedure()', PAGE)).rejects.toThrow(/read-only/i)

    await scope.end()
  })

  it('classify가 엔진 접두사별로 판정한다', () => {
    const sql = must(createMemoryDriver(CONFIG).sql, 'memory driver must expose sql')

    expect(sql.classify('  with x as (select 1) select * from x')).toBe('read')
    expect(sql.classify('SHOW TABLES')).toBe('read')
    expect(sql.classify('truncate users')).toBe('write')
    expect(sql.classify('CALL some_procedure()')).toBe('unknown')
    expect(sql.classify('')).toBe('unknown')
  })

  it('취소된 컨텍스트는 스키마 조회에서도 거부된다', async () => {
    const driver = createMemoryDriver(CONFIG)
    const schema = must(driver.schema, 'memory driver must expose schema')
    const controller = new AbortController()
    controller.abort()
    const aborted: ExecutionContext = { requestId: 'req-x', signal: controller.signal }

    await expect(schema.listTables(aborted, 'public')).rejects.toThrow(/abort/i)
  })

  it('기본 시드는 계약 스위트의 페이지네이션을 소진시킬 만큼 행을 담는다', async () => {
    // 계약의 페이지네이션 구역은 첫 테이블에 2행 이상을 요구한다.
    const driver = createMemoryDriver(CONFIG)
    const schema = must(driver.schema, 'memory driver must expose schema')
    const table = must((await schema.listTables(ctx(), 'public'))[0], 'expected a default table')

    expect(must(table.estimatedRows, 'expected estimatedRows')).toBeGreaterThanOrEqual(2)
  })

  it('기본 시드는 이름이 같고 스키마가 다른 테이블을 담는다', async () => {
    // 계약의 커서 교차사용 구역이 의미를 가지려면 두 질의가 정말로 서로 다른
    // 결과 집합이어야 한다. 시드가 한 스키마로 줄어들면 그 구역은 조용히
    // 무의미해지므로 여기서 못 박는다.
    const driver = createMemoryDriver(CONFIG)
    const schema = must(driver.schema, 'memory driver must expose schema')

    expect((await schema.listSchemas(ctx())).map((s) => s.name)).toEqual(['public', 'analytics'])
    expect((await schema.listTables(ctx(), 'public')).map((t) => t.name)).toEqual([
      'contract_probe',
    ])
    expect((await schema.listTables(ctx(), 'analytics')).map((t) => t.name)).toEqual([
      'contract_probe',
    ])
  })
})
