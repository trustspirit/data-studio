import { describe, expect, it } from 'vitest'
import type { Driver } from '@main/core/driver/Driver'
import { describeCapabilities } from '@main/core/driver/describeCapabilities'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { SqlCapability } from '@main/core/driver/capabilities/SqlCapability'
import type { SchemaCapability } from '@main/core/driver/capabilities/SchemaCapability'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'
import type { WireValue } from '@shared/types/wire'

/**
 * 모든 드라이버가 통과해야 하는 계약.
 *
 * 여기 있는 단언은 **엔진과 무관하게 참인 성질**만 담는다. 특정 엔진에서만
 * 참인 것(메모리 드라이버가 `CALL`을 unknown으로 분류한다든가, 시드 테이블
 * 이름이 무엇이라든가)은 그 드라이버 고유 테스트 파일에 있어야 한다.
 *
 * 능력이 없는 드라이버는 해당 구역을 **등록하지 않는다**. `it()` 안에서
 * `if (driver.sql === undefined) return`으로 빠져나가면 Kafka 드라이버가
 * sql 계약을 "통과"했다고 보고하게 되는데, 그건 이 스위트가 정확히 막아야
 * 하는 상황이다. 대신 실행된 구역 목록을 테스트로 노출해서, 아무것도
 * 주장하지 않은 드라이버가 조용히 초록으로 지나가지 못하게 한다.
 *
 * ## 팩토리에 요구하는 전제
 *
 * `factory()`는 호출할 때마다 **같은 능력 집합**을 가진 드라이버를 준다.
 * `schema`와 `sql`을 모두 지원한다면, 첫 스키마의 첫 테이블은 페이지네이션을
 * 실제로 소진시킬 수 있도록 **2행 이상**을 담고 있어야 한다. 1행짜리
 * 데이터셋으로는 커서가 전진하는지 아닌지를 구분할 수 없다.
 */

/** 계약 데이터셋 전체가 한 페이지에 담긴다고 가정하는 넉넉한 상한. */
const FULL_PAGE: PageRequest = { cursor: null, maxRows: 1000, maxBytes: 8_000_000 }

/** 페이지네이션이 끝나지 않을 때 무한 루프 대신 실패시키는 상한. */
const MAX_PAGES = 200

function ctx(requestId = 'contract-req'): ExecutionContext {
  return { requestId, signal: new AbortController().signal }
}

function abortedCtx(): ExecutionContext {
  const controller = new AbortController()
  controller.abort()
  return { requestId: 'contract-aborted', signal: controller.signal }
}

function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(`contract violation: ${message}`)
  return value
}

function rowKey(row: readonly WireValue[]): string {
  return JSON.stringify(row)
}

export function describeDriverContract(name: string, factory: () => Driver): void {
  // 능력 보유 여부는 테스트 **등록 시점**에 확인한다.
  const probe = factory()
  const hasSql = probe.sql !== undefined
  const hasSchema = probe.schema !== undefined
  const hasExplain = probe.sql?.explain !== undefined
  const hasBeginReadOnly = probe.sql?.beginReadOnly !== undefined

  /**
   * 실제로 등록된 구역. 드라이버가 아무 능력도 선언하지 않아서 계약이
   * 텅 빈 채 초록으로 뜨는 것을 아래 테스트가 막는다.
   */
  const sections: string[] = []
  if (hasSql) sections.push('sql')
  if (hasExplain) sections.push('sql.explain')
  if (hasBeginReadOnly) sections.push('sql.beginReadOnly')
  if (hasSql && hasSchema) sections.push('sql.pagination')
  if (hasSchema) sections.push('schema')

  /** 인스턴스마다 능력이 달라지면 등록 시점 probe가 거짓말이 된다 — 건너뛰지 않고 실패시킨다. */
  function sqlOf(driver: Driver): SqlCapability {
    return must(driver.sql, 'sql capability disappeared between instances')
  }

  function schemaOf(driver: Driver): SchemaCapability {
    return must(driver.schema, 'schema capability disappeared between instances')
  }

  /**
   * 선택 멤버는 **추출하지 않고** 좁힌다. 함수를 capability 객체에서 떼어내면
   * 드라이버가 메서드로 구현했을 때 `this`가 끊긴다 — lint의 `unbound-method`가
   * 잡는 것도 그 위험이다. 호출은 항상 capability 객체를 통해서 한다.
   */
  function assertExplain(
    sql: SqlCapability,
  ): asserts sql is SqlCapability & Required<Pick<SqlCapability, 'explain'>> {
    if (sql.explain === undefined) {
      throw new Error('contract violation: explain disappeared between instances')
    }
  }

  function assertBeginReadOnly(
    sql: SqlCapability,
  ): asserts sql is SqlCapability & Required<Pick<SqlCapability, 'beginReadOnly'>> {
    if (sql.beginReadOnly === undefined) {
      throw new Error('contract violation: beginReadOnly disappeared between instances')
    }
  }

  /** schema 능력에서 읽을 수 있는 테이블 하나를 고른다. */
  async function firstTable(driver: Driver): Promise<{ schema: string; table: string }> {
    const schema = schemaOf(driver)
    const schemas = await schema.listSchemas(ctx())
    const firstSchema = must(schemas[0], 'listSchemas returned no schema')
    const tables = await schema.listTables(ctx(), firstSchema.name)
    const firstTableInfo = must(tables[0], `listTables('${firstSchema.name}') returned no table`)

    return { schema: firstSchema.name, table: firstTableInfo.name }
  }

  describe(`${name} — 드라이버 계약`, () => {
    it('계약이 검증한 구역을 노출한다', () => {
      const driver = factory()
      const expected: string[] = []
      if (driver.sql !== undefined) expected.push('sql')
      if (driver.sql?.explain !== undefined) expected.push('sql.explain')
      if (driver.sql?.beginReadOnly !== undefined) expected.push('sql.beginReadOnly')
      if (driver.sql !== undefined && driver.schema !== undefined) expected.push('sql.pagination')
      if (driver.schema !== undefined) expected.push('schema')

      expect(sections).toEqual(expected)
      // 아무 능력도 선언하지 않은 드라이버는 계약을 "통과"할 수 없다.
      // 이 단언이 없으면 능력 0개짜리 껍데기가 조용히 초록으로 뜬다.
      expect(sections.length).toBeGreaterThan(0)
    })

    it('id와 engine을 노출한다', () => {
      const driver = factory()

      expect(driver.id.length).toBeGreaterThan(0)
      expect(driver.engine.length).toBeGreaterThan(0)
    })

    it('ping이 음이 아닌 밀리초 수치를 준다', async () => {
      const ms = await factory().ping()

      expect(Number.isFinite(ms)).toBe(true)
      expect(ms).toBeGreaterThanOrEqual(0)
    })

    it('disconnect는 두 번 불러도 던지지 않는다', async () => {
      // 풀은 정리 경로가 겹칠 때 같은 드라이버에 disconnect를 두 번 부를 수
      // 있다. 두 번째 호출이 터지면 정리 전체가 멈춘다.
      const driver = factory()

      await driver.disconnect()
      await expect(driver.disconnect()).resolves.toBeUndefined()
    })

    it('선언한 능력이 describeCapabilities와 일치한다', () => {
      const driver = factory()
      const reported = describeCapabilities(driver)

      expect(reported.includes('sql')).toBe(driver.sql !== undefined)
      expect(reported.includes('schema')).toBe(driver.schema !== undefined)
    })

    it('같은 팩토리가 항상 같은 능력 집합을 준다', () => {
      // 인스턴스마다 능력이 달라지면 등록 시점 probe가 거짓말이 된다.
      expect(describeCapabilities(factory())).toEqual(describeCapabilities(factory()))
    })

    describe.runIf(hasSql)('sql 능력', () => {
      it('필수 멤버가 함수다', () => {
        const sql = sqlOf(factory())

        expect(typeof sql.execute).toBe('function')
        expect(typeof sql.classify).toBe('function')
      })

      it('execute가 요청한 requestId를 그대로 실은 ResultSet을 준다', async () => {
        const result = await sqlOf(factory()).execute(ctx('req-echo'), 'SELECT 1', FULL_PAGE)

        expect(result.requestId).toBe('req-echo')
        expect(Array.isArray(result.columns)).toBe(true)
        expect(Array.isArray(result.rows)).toBe(true)
        expect(result.page.rowCount).toBe(result.rows.length)
        expect(typeof result.page.bytes).toBe('number')
        expect(typeof result.meta.durationMs).toBe('number')
        expect(typeof result.meta.truncatedRows).toBe('boolean')
        expect(typeof result.meta.truncatedBytes).toBe('boolean')
      })

      it('execute 결과가 structuredClone으로 IPC를 건널 수 있다', async () => {
        const result = await sqlOf(factory()).execute(ctx(), 'SELECT 1', FULL_PAGE)

        expect(structuredClone(result)).toEqual(result)
      })

      it('이미 취소된 컨텍스트로는 execute가 거부된다', async () => {
        // signal은 사용자 취소와 timeout 양쪽에서 온다. 이를 무시하는
        // 드라이버는 취소된 작업의 결과를 상위로 흘려보낸다.
        await expect(
          sqlOf(factory()).execute(abortedCtx(), 'SELECT 1', FULL_PAGE),
        ).rejects.toThrow()
      })

      it('classify가 union 안의 값만 돌려주고 던지지 않는다', () => {
        const sql = sqlOf(factory())

        for (const statement of ['SELECT 1', 'DELETE FROM x', 'CALL p()', '', '???']) {
          expect(['read', 'write', 'unknown']).toContain(sql.classify(statement))
        }
      })

      it('classify가 읽기 문장을 read로 분류한다', () => {
        expect(sqlOf(factory()).classify('SELECT 1')).toBe('read')
      })

      it('classify가 쓰기 문장을 write로 분류한다', () => {
        expect(sqlOf(factory()).classify('DELETE FROM users')).toBe('write')
      })
    })

    describe.runIf(hasExplain)('sql.explain 능력', () => {
      it('explain이 analyze 여부를 결과에 표시한다', async () => {
        const sql = sqlOf(factory())
        assertExplain(sql)
        const plain = await sql.explain(ctx(), 'SELECT 1', { analyze: false })
        const analyzed = await sql.explain(ctx(), 'SELECT 1', { analyze: true })

        expect(plain.analyzed).toBe(false)
        expect(analyzed.analyzed).toBe(true)
        expect(plain.text.length).toBeGreaterThan(0)
        expect(analyzed.text.length).toBeGreaterThan(0)
      })

      it('explain 결과가 IPC를 건널 수 있다', async () => {
        const sql = sqlOf(factory())
        assertExplain(sql)
        const plan = await sql.explain(ctx(), 'SELECT 1', { analyze: false })

        expect(structuredClone(plan)).toEqual(plan)
      })
    })

    describe.runIf(hasBeginReadOnly)('sql.beginReadOnly 능력', () => {
      it('범위 안에서 쓰기 문장이 거부된다', async () => {
        const sql = sqlOf(factory())
        assertBeginReadOnly(sql)
        const scope = await sql.beginReadOnly(ctx())

        await expect(scope.execute(ctx(), 'DELETE FROM users', FULL_PAGE)).rejects.toThrow()

        await scope.end()
      })

      it('범위 안에서 읽기 문장은 동작한다', async () => {
        const sql = sqlOf(factory())
        assertBeginReadOnly(sql)
        const scope = await sql.beginReadOnly(ctx())
        const result = await scope.execute(ctx(), 'SELECT 1', FULL_PAGE)

        expect(result.page.rowCount).toBeGreaterThanOrEqual(0)

        await scope.end()
      })
    })

    describe.runIf(hasSql && hasSchema)('sql 페이지네이션 계약', () => {
      /**
       * `cursorAt`이 존재하는 이유를 끝까지 몰아붙인다.
       *
       * 한 페이지에 다 담았을 때의 행 시퀀스와, 한 행씩 끊어 커서로 이어
       * 읽었을 때의 행 시퀀스가 **정확히 같아야** 한다. 빠진 행도, 중복된
       * 행도, 끝나지 않는 루프도 없어야 한다. 배치 전체 기준으로 커서를
       * 계산한 드라이버는 여기서 반드시 걸린다 — 잘려나간 행이 사라지기
       * 때문이다.
       */
      it('한 행씩 끊어 읽은 결과가 한 번에 읽은 결과와 완전히 같다', async () => {
        const driver = factory()
        const sql = sqlOf(driver)
        const { schema, table } = await firstTable(driver)
        const statement = `SELECT * FROM ${schema}.${table}`

        const full = await sql.execute(ctx(), statement, FULL_PAGE)

        // 기준 페이지가 잘렸다면 아래 비교가 무의미해진다.
        expect(full.meta.truncatedRows).toBe(false)
        expect(full.meta.truncatedBytes).toBe(false)
        // 1행짜리 데이터셋으로는 커서가 전진하는지 알 수 없다.
        expect(full.rows.length).toBeGreaterThanOrEqual(2)

        const collected: (readonly WireValue[])[] = []
        const seenCursors = new Set<string>()
        let cursor: string | null = null
        let pages = 0

        for (;;) {
          if (pages >= MAX_PAGES) {
            throw new Error(
              `pagination did not terminate within ${MAX_PAGES} pages ` +
                `(collected ${collected.length} rows of ${full.rows.length})`,
            )
          }

          const page: ResultSet = await sql.execute(ctx(), statement, {
            cursor,
            maxRows: 1,
            maxBytes: FULL_PAGE.maxBytes,
          })
          pages += 1

          expect(page.rows.length).toBeLessThanOrEqual(1)
          expect(page.page.rowCount).toBe(page.rows.length)
          collected.push(...page.rows)

          const next: string | null = page.page.cursor
          if (next === null) {
            // 커서가 없으면 더 읽을 것이 없다고 선언한 것이다.
            expect(page.page.hasMore).toBe(false)
            break
          }

          // 같은 커서를 두 번 돌려주면 호출자는 영원히 같은 페이지를 받는다.
          expect(seenCursors.has(next)).toBe(false)
          seenCursors.add(next)
          expect(page.page.hasMore).toBe(true)
          cursor = next
        }

        // 빠짐도 중복도 순서 뒤바뀜도 없이 정확히 같아야 한다.
        expect(collected).toEqual(full.rows)
        expect(new Set(collected.map(rowKey)).size).toBe(new Set(full.rows.map(rowKey)).size)
        // 행 수보다 페이지 수가 적으면 상한이 무시된 것이다.
        expect(pages).toBeGreaterThanOrEqual(full.rows.length)
      })

      it('maxRows 상한을 넘겨 돌려주지 않고, 넘칠 때 truncatedRows를 표시한다', async () => {
        const driver = factory()
        const sql = sqlOf(driver)
        const { schema, table } = await firstTable(driver)
        const statement = `SELECT * FROM ${schema}.${table}`

        const full = await sql.execute(ctx(), statement, FULL_PAGE)
        expect(full.rows.length).toBeGreaterThanOrEqual(2)

        const limited = await sql.execute(ctx(), statement, {
          cursor: null,
          maxRows: 1,
          maxBytes: FULL_PAGE.maxBytes,
        })

        expect(limited.rows).toHaveLength(1)
        expect(limited.page.hasMore).toBe(true)
        expect(limited.page.cursor).not.toBeNull()
      })
    })

    describe.runIf(hasSchema)('schema 능력', () => {
      it('다섯 메서드가 모두 함수다', () => {
        const schema = schemaOf(factory())

        expect(typeof schema.listSchemas).toBe('function')
        expect(typeof schema.listTables).toBe('function')
        expect(typeof schema.describeTable).toBe('function')
        expect(typeof schema.listIndexes).toBe('function')
        expect(typeof schema.listForeignKeys).toBe('function')
      })

      it('listSchemas와 listTables가 IPC를 건널 수 있는 값을 준다', async () => {
        const driver = factory()
        const schema = schemaOf(driver)
        const schemas = await schema.listSchemas(ctx())

        expect(structuredClone(schemas)).toEqual(schemas)
        // 계약상 드라이버는 최소 하나의 스키마를 보고해야 한다 —
        // 빈 목록이면 아래 검증이 조용히 무의미해진다.
        expect(schemas.length).toBeGreaterThan(0)

        const first = must(schemas[0], 'listSchemas returned no schema')
        const tables = await schema.listTables(ctx(), first.name)

        expect(structuredClone(tables)).toEqual(tables)
        expect(tables.length).toBeGreaterThan(0)
      })

      it('listTables가 요청한 스키마의 테이블만 돌려준다', async () => {
        const driver = factory()
        const schema = schemaOf(driver)
        const schemas = await schema.listSchemas(ctx())
        const first = must(schemas[0], 'listSchemas returned no schema')
        const tables = await schema.listTables(ctx(), first.name)

        for (const table of tables) {
          expect(table.schema).toBe(first.name)
          expect(table.name.length).toBeGreaterThan(0)
          expect(['table', 'view', 'materialized_view']).toContain(table.kind)
          expect(table.estimatedRows === null || typeof table.estimatedRows === 'number').toBe(true)
        }
      })

      it('존재하지 않는 스키마에는 테이블을 보고하지 않는다', async () => {
        const tables = await schemaOf(factory()).listTables(
          ctx(),
          '__contract_schema_that_does_not_exist__',
        )

        expect(tables).toEqual([])
      })

      it('describeTable이 listTables가 보고한 테이블의 컬럼을 돌려준다', async () => {
        const driver = factory()
        const schema = schemaOf(driver)
        const { schema: schemaName, table } = await firstTable(driver)
        const detail = await schema.describeTable(ctx(), schemaName, table)

        expect(detail.schema).toBe(schemaName)
        expect(detail.name).toBe(table)
        expect(detail.columns.length).toBeGreaterThan(0)
        expect(structuredClone(detail)).toEqual(detail)

        for (const column of detail.columns) {
          expect(column.name.length).toBeGreaterThan(0)
          expect(typeof column.type).toBe('string')
          expect(typeof column.nullable).toBe('boolean')
          expect(typeof column.isPrimaryKey).toBe('boolean')
          expect(column.defaultValue === null || typeof column.defaultValue === 'string').toBe(true)
        }
      })

      it('listIndexes와 listForeignKeys가 IPC를 건널 수 있는 배열을 준다', async () => {
        const driver = factory()
        const schema = schemaOf(driver)
        const { schema: schemaName, table } = await firstTable(driver)

        const indexes = await schema.listIndexes(ctx(), schemaName, table)
        const foreignKeys = await schema.listForeignKeys(ctx(), schemaName, table)

        expect(Array.isArray(indexes)).toBe(true)
        expect(Array.isArray(foreignKeys)).toBe(true)
        expect(structuredClone(indexes)).toEqual(indexes)
        expect(structuredClone(foreignKeys)).toEqual(foreignKeys)

        for (const index of indexes) {
          expect(index.name.length).toBeGreaterThan(0)
          expect(Array.isArray(index.columns)).toBe(true)
          expect(typeof index.unique).toBe('boolean')
        }

        for (const fk of foreignKeys) {
          expect(fk.name.length).toBeGreaterThan(0)
          expect(fk.columns.length).toBeGreaterThan(0)
          expect(fk.referencedColumns.length).toBeGreaterThan(0)
        }
      })
    })
  })
}
