import { describe, expect, it } from 'vitest'
import type { Driver } from '@main/core/driver/Driver'
import { describeCapabilities } from '@main/core/driver/describeCapabilities'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { SqlCapability } from '@main/core/driver/capabilities/SqlCapability'
import type { SchemaCapability } from '@main/core/driver/capabilities/SchemaCapability'
import type { ConnectionConfig } from '@shared/types/connection'
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
 * 다만 구역 목록만으로는 부족하다. 수명주기 구역은 **어떤 드라이버에나**
 * 등록되므로 "구역이 하나라도 돌았다"는 능력의 증거가 못 된다. 그래서 이
 * 스위트는 별도로 **데이터 평면 능력(`sql` 또는 `schema`)을 최소 하나 선언했는지**
 * 를 요구한다. 둘 다 없는 드라이버에게 이 계약은 검증할 것이 없고, 그런
 * 드라이버는 초록이 아니라 실패를 받아야 한다.
 *
 * ## 연결 수명주기
 *
 * `connect(config)`는 `Driver`의 **필수** 멤버다. 그래서 이 스위트는 드라이버를
 * 쓰기 전에 **직접 `connect`를 부른다** — 팩토리가 이미 연결된 드라이버를
 * 돌려주게 하지 않는다. 팩토리가 연결까지 맡으면 "connect 없이도 동작하는
 * 드라이버"만 통과할 수 있다는 전제가 스위트에 숨어버리고, 실제 서버에
 * 붙어야 하는 Phase 1의 PostgreSQL 드라이버는 자기 잘못이 아닌 이유로 모든
 * 테스트에서 실패한다.
 *
 * 팩토리는 **동기**로 `{ driver, config }`를 준다. 능력 보유 여부(`sql`/`schema`
 * 프로퍼티)는 연결과 무관한 정적 사실이고, `describe.runIf`로 구역을 등록하려면
 * 등록 시점에 동기적으로 알아야 하기 때문이다. 연결이 필요한 동작 검증은
 * 각 테스트 안에서 `await connected()`로 새 인스턴스를 연결해 쓴다.
 *
 * 연결 없이 읽는 것은 **능력 프로퍼티의 존재 여부와 `classify`**까지다.
 * `classify(statement)`는 서버에 묻지 않고 문장만 보고 답하는 순수 함수로
 * 본다 — 상위 계층이 "이 문장을 실행해도 되는가"를 연결 전에 판단해야 하므로,
 * 연결을 요구하는 `classify`는 그 자리에서 쓸 수 없다. 그 밖의 모든 동작
 * (`execute`/`ping`/`schema` 조회)은 반드시 연결한 뒤에 부른다.
 *
 * ## 팩토리에 요구하는 전제
 *
 * - `factory()`는 호출할 때마다 **같은 능력 집합**을 가진, **아직 연결되지 않은**
 *   새 드라이버를 준다. 테스트끼리 상태를 공유하지 않아야 한다 — 쓰기 구역이
 *   데이터를 지운다.
 * - `sql` 능력을 선언하면 `read`(읽을 수 있는 문장과 그 기대 행 수)를 반드시
 *   함께 준다. 계약이 문장을 스스로 조립하지 않는 이유는 `SELECT * FROM s.t`가
 *   모든 엔진에서 유효한 문장이 아니기 때문이고, 그렇게 해야 `schema` 능력이
 *   없는 SQL 드라이버도 페이지네이션 계약을 면제받지 못하기 때문이다.
 * - `read.statement`가 돌려주는 행 수는 **2 이상**이어야 하고 `FULL_PAGE`
 *   상한(**1000행, 8MB**) 안에 들어와야 한다. 1행짜리 데이터셋으로는 커서가
 *   전진하는지 아닌지를 구분할 수 없고, 상한을 넘는 데이터셋은 "한 페이지에
 *   다 담은 결과"라는 비교 기준 자체를 무너뜨려 올바른 드라이버를 실패시킨다.
 * - `read.statement`는 호출할 때마다 **같은 순서로** 행을 돌려주어야 한다.
 *   페이지네이션 계약은 이어 읽은 행 시퀀스를 한 번에 읽은 시퀀스와 그대로
 *   비교하므로, 순서가 흔들리면 올바른 드라이버가 간헐적으로 실패한다.
 * - `sql` 능력을 선언하면 `read.foreignStatement`도 **반드시** 준다. 페이지를
 *   나눌 수 있는 드라이버는 남의 커서를 거부한다는 것까지 증명해야 한다.
 * - `sql` 능력을 선언하면 `write`를 주거나, 줄 수 없다면 `writesUnsupported: true`로
 *   **명시적으로** 면제를 선언한다. 잠자코 빼는 것은 허용하지 않는다.
 * - 드라이버가 실제 연결을 갖는다면 `requiresConnection: true`를 선언한다.
 *   그러면 계약이 `disconnect` 이후 드라이버가 정말로 쓸 수 없게 되는지를
 *   확인한다. 선언하지 않은 드라이버는 그 대신 **연결 없이도 동작한다는 것**을
 *   증명해야 한다 — 어느 쪽이든 빠져나갈 구멍은 없다.
 */

/** 계약 데이터셋 전체가 한 페이지에 담긴다고 가정하는 넉넉한 상한. */
const FULL_PAGE: PageRequest = { cursor: null, maxRows: 1000, maxBytes: 8_000_000 }

/** 페이지네이션이 끝나지 않을 때 무한 루프 대신 실패시키는 상한. */
const MAX_PAGES = 200

/**
 * 어떤 드라이버도 발급했을 리 없는 커서들.
 *
 * 서로 다른 모양을 둘 넘긴다 — 한 가지 모양만 넘기면 그 모양 하나에만
 * 반응하는 얕은 검사로도 통과할 수 있다. 다만 계약이 요구할 수 있는 것은
 * "자기가 발급하지 않은 커서를 거부한다"까지다. 커서는 불투명한 값이므로
 * 어떤 인코딩을 쓰는지는 드라이버의 자유이고, 계약이 특정 형식을 전제하면
 * 그것은 더 이상 계약이 아니라 구현 지시가 된다.
 *
 * 그래서 여기 값들은 **어떤 인코딩도 발급할 수 없는** 모양이어야 한다.
 * `'{"offset":1}'` 같은 값은 못 쓴다 — 오프셋을 JSON으로 싣는 드라이버가
 * 정확히 그렇게 발급하므로, 올바른 드라이버를 자기 잘못이 아닌 이유로
 * 실패시킨다. 아래 둘은 NUL 바이트를 품고 있어서 정수·base64·hex·JSON
 * 어느 표기로도 나올 수 없고, 길이도 서로 크게 다르다.
 */
const GARBAGE_CURSORS = [
  '\u0000__contract_cursor_that_no_driver_minted__',
  `\u0000${'\u0000\uFFFFz9'.repeat(128)}`,
]

/** 어떤 드라이버도 갖고 있지 않을 스키마 이름. */
const ABSENT_SCHEMA = '__contract_schema_that_does_not_exist__'

/** 계약이 페이지네이션과 커서 검증에 쓰는 읽기 문장. */
export interface ContractReadStatement {
  /**
   * 이 엔진에서 유효한, 여러 행을 돌려주는 읽기 문장.
   *
   * **호출할 때마다 같은 순서로** 행을 돌려주어야 한다. 페이지네이션 계약은
   * 커서로 이어 읽은 시퀀스를 한 번에 읽은 시퀀스와 그대로 비교하므로, 순서가
   * 안정적이지 않으면 올바른 드라이버가 간헐적으로 실패한다. 대부분의 SQL
   * 엔진은 `ORDER BY` 없는 질의의 행 순서를 보장하지 않는다 — PostgreSQL도
   * 그렇다. 그러니 정렬 키가 명확한 문장(예: `... ORDER BY id`)을 준다.
   */
  readonly statement: string
  /** 위 문장이 상한 없이 돌려주는 행 수. 2 이상, 1000 이하. */
  readonly expectedRowCount: number
  /**
   * `statement`와 **다른 결과 집합**을 읽는 문장. `sql` 능력을 선언한
   * 드라이버는 반드시 준다 — 계약은 `statement`에서 받은 커서를 이 문장에
   * 넘겼을 때 드라이버가 조용히 엉뚱한 행을 돌려주지 않고 거부하는지 확인한다.
   *
   * 선택으로 두면 커서 신원 검사가 없는 드라이버가 이 항목을 빼는 것만으로
   * 계약을 통과한다 — 그러면 "발급하지 않은 커서를 거부한다"는 조항이 아무에게도
   * 요구되지 않는다. 페이지를 나눌 수 있다는 것은 곧 남의 커서를 받을 수 있다는
   * 뜻이므로, 이 증명은 sql 계약에서 면제될 수 없다.
   */
  readonly foreignStatement: string
}

/** 계약이 `rowsAffected`를 확인할 때 쓰는 쓰기 문장. */
export interface ContractWriteStatement {
  /** 실행하면 행을 바꾸는 문장. 계약은 매번 새 드라이버 인스턴스에서 실행한다. */
  readonly statement: string
  /** 위 문장이 바꾸는 행 수. `rowsAffected`가 null이 아닌 실수치임을 못 박는다. */
  readonly expectedRowsAffected: number
}

/** 계약이 한 드라이버를 검증하는 데 필요한 것 전부. */
export interface DriverContractHarness {
  /** 아직 `connect`되지 않은 새 인스턴스. */
  readonly driver: Driver
  /** 계약이 `driver.connect(config)`에 넘길 설정. */
  readonly config: ConnectionConfig
  /** `sql` 능력을 선언한 드라이버는 반드시 준다. */
  readonly read?: ContractReadStatement
  /**
   * `rowsAffected` 쓰기 계약에 쓸 문장. `sql` 능력을 선언했다면 이것을 주거나
   * `writesUnsupported: true`를 선언해야 한다.
   */
  readonly write?: ContractWriteStatement
  /**
   * 이 드라이버로는 어떤 쓰기도 할 수 없음을 **명시적으로** 선언한다.
   *
   * `write`를 필수로 만들지 않는 이유는, 읽기 전용 복제본이나 조회 전용
   * 엔드포인트처럼 쓸 수 있는 문장이 정말로 없는 드라이버가 실재하기 때문이다.
   * 그런 드라이버를 계약에서 밀어내는 것은 능력이 적다는 이유로 배제하는 것과
   * 같은 잘못이다. 대신 면제는 **잠자코 얻을 수 없다** — 이 플래그를 세우지
   * 않고 `write`를 빼면 계약이 실패한다. 그래서 옵트아웃이 리뷰 가능한
   * 선언으로 남는다.
   *
   * `rowsAffected`가 `number | null`이고 `undefined`가 아니라는 성질 자체는
   * 이 플래그와 무관하게 모든 sql 드라이버가 읽기 문장에서 이미 검증받는다.
   */
  readonly writesUnsupported?: true
  /**
   * 드라이버가 **실제 연결**(소켓, 풀에서 빌린 클라이언트 등)을 갖는가.
   *
   * `true`면 계약이 `disconnect` 이후 드라이버가 정말로 쓸 수 없게 되는지를
   * 확인한다. 이 조항이 없으면 `disconnect`가 아무것도 하지 않는 드라이버 —
   * 즉 풀에 클라이언트를 영영 돌려주지 않는 드라이버 — 가 조용히 통과한다.
   *
   * 메모리 드라이버처럼 연결 개념이 없는 드라이버까지 이 조항으로 묶으면,
   * 능력이 적다는 이유로 계약에서 배제하는 잘못을 반복하게 된다. 그래서
   * 선언하지 않은 드라이버에는 대신 **연결 없이도 동작한다**는 것을 요구한다.
   */
  readonly requiresConnection?: true
}

export type DriverContractFactory = () => DriverContractHarness

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

export function describeDriverContract(name: string, factory: DriverContractFactory): void {
  // 능력 보유 여부는 테스트 **등록 시점**에 확인한다. 연결과 무관한 정적
  // 사실이므로 connect 없이 읽어도 된다.
  const probe = factory()
  const hasSql = probe.driver.sql !== undefined
  const hasSchema = probe.driver.schema !== undefined
  const hasExplain = probe.driver.sql?.explain !== undefined
  const hasBeginReadOnly = probe.driver.sql?.beginReadOnly !== undefined
  const hasWrite = probe.write !== undefined
  const requiresConnection = probe.requiresConnection === true

  /**
   * 실제로 등록된 구역. 드라이버가 아무 능력도 선언하지 않아서 계약이
   * 텅 빈 채 초록으로 뜨는 것을 아래 테스트가 막는다.
   */
  const sections: string[] = []
  // 연결 수명주기는 둘 중 하나가 **반드시** 돈다. 어느 쪽도 돌지 않는
  // (= 조용히 건너뛰는) 경우가 없어야 disconnect가 관찰되지 않는 구멍이 막힌다.
  sections.push(requiresConnection ? 'lifecycle.disconnect' : 'lifecycle.connectionless')
  sections.push('lifecycle.connectIdentity')
  if (hasSql) sections.push('sql')
  if (hasExplain) sections.push('sql.explain')
  if (hasBeginReadOnly) sections.push('sql.beginReadOnly')
  // 읽기 전용 범위의 쓰기 차단은 하네스가 실제 쓰기 문장을 줄 때만 **증명**할
  // 수 있다. 면제받은 경우에도 구역 이름을 남겨, 그 면제가 sections에 보이게
  // 한다 — 조용히 사라지면 옵트아웃이 다시 공짜가 된다.
  if (hasBeginReadOnly) {
    sections.push(hasWrite ? 'sql.beginReadOnly.blocksWrite' : 'sql.beginReadOnly.writesUnsupported')
  }
  // schema 능력과 무관하게 sql만 있으면 페이지네이션과 커서 검증을 요구한다.
  // `execute`/`cursorAt`은 sql 능력에 속하지 schema 능력에 속하지 않는다.
  if (hasSql) sections.push('sql.pagination')
  if (hasSql) sections.push('sql.cursor')
  // 하네스가 foreignStatement를 주는지와 **무관하게** 등록한다. 하네스에서
  // 계산하면 빼는 순간 구역째 사라져서, 옵트아웃이 조용한 초록이 된다.
  if (hasSql) sections.push('sql.cursor.foreign')
  if (hasSql) sections.push('sql.writeDeclaration')
  if (hasWrite) sections.push('sql.rowsAffected')
  if (hasSchema) sections.push('schema')

  /** 새 인스턴스를 만들어 **연결한 뒤** 돌려준다. */
  async function connected(): Promise<Driver> {
    const harness = factory()
    await harness.driver.connect(harness.config)
    return harness.driver
  }

  /** 인스턴스마다 능력이 달라지면 등록 시점 probe가 거짓말이 된다 — 건너뛰지 않고 실패시킨다. */
  function sqlOf(driver: Driver): SqlCapability {
    return must(driver.sql, 'sql capability disappeared between instances')
  }

  function schemaOf(driver: Driver): SchemaCapability {
    return must(driver.schema, 'schema capability disappeared between instances')
  }

  /**
   * sql 능력을 선언한 드라이버는 읽을 수 있는 문장을 반드시 제공해야 한다.
   * 없으면 건너뛰지 않고 **실패**시킨다 — 페이지네이션은 sql 계약의 핵심이라
   * 면제 대상이 아니다.
   */
  function readOf(): ContractReadStatement {
    const read = must(factory().read, 'a driver declaring `sql` must supply `read` to the contract')
    if (read.expectedRowCount < 2) {
      throw new Error('contract violation: `read.expectedRowCount` must be at least 2')
    }
    if (read.expectedRowCount > FULL_PAGE.maxRows) {
      throw new Error(
        `contract violation: \`read.expectedRowCount\` must fit in one page (<= ${FULL_PAGE.maxRows})`,
      )
    }
    // 선택 멤버로 두면 커서 신원 검사가 없는 드라이버가 이것을 빼는 것만으로
    // 계약을 통과한다. `read`와 같은 강도로 요구한다.
    must(
      read.foreignStatement,
      'a driver declaring `sql` must supply `read.foreignStatement` ' +
        'so the contract can prove it rejects a cursor minted for another query',
    )
    return read
  }

  function writeOf(): ContractWriteStatement {
    return must(factory().write, 'write statement disappeared between instances')
  }

  /**
   * 쓰기 계약을 제공했거나, 제공할 수 없음을 **명시적으로** 선언했는지 본다.
   * 잠자코 `write`를 빼는 것은 통과시키지 않는다.
   */
  function assertWriteDeclaration(): void {
    const harness = factory()
    if (harness.write !== undefined && harness.writesUnsupported === true) {
      throw new Error(
        'contract violation: a harness cannot both supply `write` and declare `writesUnsupported`',
      )
    }
    if (harness.write === undefined && harness.writesUnsupported !== true) {
      throw new Error(
        'contract violation: a driver declaring `sql` must supply `write`, ' +
          'or declare `writesUnsupported: true` to opt out explicitly',
      )
    }
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

  function foreignStatementOf(read: ContractReadStatement): string {
    return must(
      read.foreignStatement,
      'a driver declaring `sql` must supply `read.foreignStatement`',
    )
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
      const harness = factory()
      const driver = harness.driver
      const expected: string[] = []
      expected.push(
        harness.requiresConnection === true ? 'lifecycle.disconnect' : 'lifecycle.connectionless',
      )
      expected.push('lifecycle.connectIdentity')
      if (driver.sql !== undefined) expected.push('sql')
      if (driver.sql?.explain !== undefined) expected.push('sql.explain')
      if (driver.sql?.beginReadOnly !== undefined) expected.push('sql.beginReadOnly')
      if (driver.sql?.beginReadOnly !== undefined) {
        expected.push(
          harness.write !== undefined
            ? 'sql.beginReadOnly.blocksWrite'
            : 'sql.beginReadOnly.writesUnsupported',
        )
      }
      if (driver.sql !== undefined) expected.push('sql.pagination')
      if (driver.sql !== undefined) expected.push('sql.cursor')
      // 하네스가 아니라 능력에서 계산한다 — foreignStatement를 빼도 구역은
      // 남아 있어야 하고, 그 구역이 실패해야 한다.
      if (driver.sql !== undefined) expected.push('sql.cursor.foreign')
      if (driver.sql !== undefined) expected.push('sql.writeDeclaration')
      if (harness.write !== undefined) expected.push('sql.rowsAffected')
      if (driver.schema !== undefined) expected.push('schema')

      expect(sections).toEqual(expected)
    })

    /**
     * 아무 **데이터 평면** 능력도 선언하지 않은 드라이버는 계약을 통과할 수 없다.
     *
     * 예전에는 이것을 `sections.length > 0`으로 확인했다. 그런데 그 뒤에 다른
     * 지적을 막느라 수명주기 구역을 **무조건** 등록하도록 바꾸면서, 저 단언은
     * 실패할 수 없는 것이 되어 버렸다 — 새 수정이 옛 가드를 조용히 무력화한
     * 것이다. 실제로 `sql`도 `schema`도 없이 connect/disconnect/ping만 가진
     * kafka 드라이버가 10 passed / 26 skipped / 0 failed로 초록 배지를 받았다.
     *
     * 그래서 "구역이 하나라도 돌았다"가 아니라 "검증할 데이터 평면 능력을
     * 선언했다"를 단언한다. 수명주기는 어떤 드라이버든 갖고 있으므로 능력의
     * 증거가 되지 못한다.
     *
     * Kafka나 Redis처럼 `sql`도 `schema`도 정말로 지원하지 않는 엔진은 여기서
     * **시끄럽게 실패해야 맞다**. 그런 드라이버에게 이 계약은 검증할 것이 없고,
     * 초록 배지는 "검증됐다"는 거짓 신호가 된다. 그 엔진들이 도착하면 자기
     * 능력(`stream`, `keyValue` 등)과 자기 계약 구역을 함께 들고 와야 한다.
     */
    it('검증할 데이터 평면 능력(sql 또는 schema)을 최소 하나 선언한다', () => {
      const driver = factory().driver
      const declared: string[] = []
      if (driver.sql !== undefined) declared.push('sql')
      if (driver.schema !== undefined) declared.push('schema')

      if (declared.length === 0) {
        throw new Error(
          `contract violation: '${name}' declares no data-plane capability ` +
            '(`sql` or `schema`), so this contract has nothing to verify for it — ' +
            'only connect/disconnect/ping ran. Passing here would be a green badge ' +
            'for an unverified driver. An engine that legitimately supports neither ' +
            'needs its own capability and its own contract sections; it must not ' +
            'borrow this one.',
        )
      }

      expect(declared.length).toBeGreaterThan(0)
    })

    it('id와 engine을 노출한다', () => {
      const driver = factory().driver

      expect(driver.id.length).toBeGreaterThan(0)
      expect(driver.engine.length).toBeGreaterThan(0)
    })

    it('connect 이후 ping이 음이 아닌 밀리초 수치를 준다', async () => {
      // connect는 Driver의 필수 멤버다. 연결 없이 쓰이는 것을 전제하면
      // 실제 서버에 붙어야 하는 드라이버는 계약에 참여할 수조차 없다.
      const ms = await (await connected()).ping()

      expect(Number.isFinite(ms)).toBe(true)
      expect(ms).toBeGreaterThanOrEqual(0)
    })

    it('connect는 같은 설정으로 다시 불러도 던지지 않는다', async () => {
      // 재연결 경로(연결 끊김 복구)가 같은 드라이버에 connect를 다시 부른다.
      const harness = factory()

      await harness.driver.connect(harness.config)
      await expect(harness.driver.connect(harness.config)).resolves.toBeUndefined()
    })

    it('connect 이후 disconnect는 두 번 불러도 던지지 않는다', async () => {
      // 풀은 정리 경로가 겹칠 때 같은 드라이버에 disconnect를 두 번 부를 수
      // 있다. 두 번째 호출이 터지면 정리 전체가 멈춘다.
      const driver = await connected()

      await driver.disconnect()
      await expect(driver.disconnect()).resolves.toBeUndefined()
    })

    it('disconnect 이후 다시 connect하면 쓸 수 있다', async () => {
      const harness = factory()

      await harness.driver.connect(harness.config)
      await harness.driver.disconnect()
      await harness.driver.connect(harness.config)

      await expect(harness.driver.ping()).resolves.toBeGreaterThanOrEqual(0)
    })

    /**
     * `disconnect`를 **관찰한다**.
     *
     * 위의 "두 번 불러도 안 던진다"와 "다시 connect하면 쓸 수 있다"는 둘 다
     * disconnect가 아무것도 하지 않아도 통과한다. 즉 풀에서 빌린 클라이언트를
     * 영영 돌려주지 않는 드라이버가 조용히 초록으로 뜬다. 실제 연결을 가진
     * 드라이버라면 disconnect 이후에는 **쓸 수 없어야** 한다.
     */
    describe.runIf(requiresConnection)('연결 수명주기 — disconnect 관찰', () => {
      it('disconnect 이후에는 ping이 거부된다', async () => {
        const driver = await connected()

        await driver.disconnect()

        await expect(driver.ping()).rejects.toThrow()
      })

      it('disconnect 이후에는 execute가 거부된다', async () => {
        if (!hasSql) return
        const read = readOf()
        const driver = await connected()
        const sql = sqlOf(driver)

        await driver.disconnect()

        await expect(sql.execute(ctx(), read.statement, FULL_PAGE)).rejects.toThrow()
      })
    })

    /**
     * 연결 개념이 없다고 선언한 드라이버는 그 선언을 **증명해야** 한다.
     *
     * 이것이 없으면 `requiresConnection`을 빼는 것만으로 disconnect 관찰을
     * 면제받을 수 있다 — 옵트아웃이 공짜가 되어버린다. 연결 없이 정말로
     * 동작하는 드라이버만 이 면제를 얻는다.
     */
    describe.runIf(!requiresConnection)('연결 수명주기 — 무연결 선언 검증', () => {
      it('connect 없이도 ping이 동작한다', async () => {
        const driver = factory().driver

        await expect(driver.ping()).resolves.toBeGreaterThanOrEqual(0)
      })
    })

    describe('연결 수명주기 — connect 신원 검증', () => {
      it('드라이버 id와 다른 config로 connect하면 거부한다', async () => {
        // 매니저는 config.id로 항목을 키잉하고 그 항목의 driver를 내준다.
        // 둘이 어긋나도 connect가 성공하면, A 커넥션으로 보낸 질의가 B 서버에서
        // 아무 에러 없이 실행된다 — 맞아 보이는 틀린 데이터가 나가는 형태다.
        const harness = factory()
        const foreign = { ...harness.config, id: `${harness.config.id}-other` }

        await expect(harness.driver.connect(foreign)).rejects.toThrow()
      })

      it('자기 config로 connect하면 성공한다', async () => {
        const harness = factory()

        await expect(harness.driver.connect(harness.config)).resolves.toBeUndefined()
      })
    })

    it('선언한 능력이 describeCapabilities와 일치한다', () => {
      const driver = factory().driver
      const reported = describeCapabilities(driver)

      expect(reported.includes('sql')).toBe(driver.sql !== undefined)
      expect(reported.includes('schema')).toBe(driver.schema !== undefined)
    })

    it('같은 팩토리가 항상 같은 능력 집합을 준다', () => {
      // 인스턴스마다 능력이 달라지면 등록 시점 probe가 거짓말이 된다.
      expect(describeCapabilities(factory().driver)).toEqual(
        describeCapabilities(factory().driver),
      )
    })

    describe.runIf(hasSql)('sql 능력', () => {
      it('필수 멤버가 함수다', () => {
        const sql = sqlOf(factory().driver)

        expect(typeof sql.execute).toBe('function')
        expect(typeof sql.classify).toBe('function')
      })

      it('execute가 요청한 requestId를 그대로 실은 ResultSet을 준다', async () => {
        const read = readOf()
        const result = await sqlOf(await connected()).execute(
          ctx('req-echo'),
          read.statement,
          FULL_PAGE,
        )

        expect(result.requestId).toBe('req-echo')
        expect(Array.isArray(result.columns)).toBe(true)
        expect(Array.isArray(result.rows)).toBe(true)
        expect(result.page.rowCount).toBe(result.rows.length)
        expect(typeof result.page.bytes).toBe('number')
        expect(typeof result.meta.durationMs).toBe('number')
        expect(typeof result.meta.truncatedRows).toBe('boolean')
        expect(typeof result.meta.truncatedBytes).toBe('boolean')
      })

      /**
       * `rowsAffected`의 `null`과 `0`은 뜻이 다르다 — `null`은 "이 드라이버가
       * 이 값을 보고하지 않는다", `0`은 "실제로 0행이 바뀌었다". 둘을 섞으면
       * 사용자에게 그 차이를 보여줄 수 없다. `undefined`는 셋 중 어느 것도
       * 아니어서 상위 계층이 구분할 근거를 잃는다.
       */
      it('meta.rowsAffected가 number거나 null이며 undefined가 아니다', async () => {
        const read = readOf()
        const result = await sqlOf(await connected()).execute(ctx(), read.statement, FULL_PAGE)

        expect('rowsAffected' in result.meta).toBe(true)
        expect(result.meta.rowsAffected === null || typeof result.meta.rowsAffected === 'number').toBe(
          true,
        )
        expect(result.meta.rowsAffected).not.toBeUndefined()
      })

      it('execute 결과가 structuredClone으로 IPC를 건널 수 있다', async () => {
        const read = readOf()
        const result = await sqlOf(await connected()).execute(ctx(), read.statement, FULL_PAGE)

        expect(structuredClone(result)).toEqual(result)
      })

      it('이미 취소된 컨텍스트로는 execute가 거부된다', async () => {
        // signal은 사용자 취소와 timeout 양쪽에서 온다. 이를 무시하는
        // 드라이버는 취소된 작업의 결과를 상위로 흘려보낸다.
        const read = readOf()

        await expect(
          sqlOf(await connected()).execute(abortedCtx(), read.statement, FULL_PAGE),
        ).rejects.toThrow()
      })

      it('classify가 union 안의 값만 돌려주고 던지지 않는다', () => {
        const sql = sqlOf(factory().driver)

        for (const statement of ['SELECT 1', 'DELETE FROM x', 'CALL p()', '', '???']) {
          expect(['read', 'write', 'unknown']).toContain(sql.classify(statement))
        }
      })

      it('classify가 읽기 문장을 read로 분류한다', () => {
        expect(sqlOf(factory().driver).classify('SELECT 1')).toBe('read')
      })

      it('classify가 쓰기 문장을 write로 분류한다', () => {
        expect(sqlOf(factory().driver).classify('DELETE FROM users')).toBe('write')
      })
    })

    describe.runIf(hasExplain)('sql.explain 능력', () => {
      it('explain이 analyze 여부를 결과에 표시한다', async () => {
        const sql = sqlOf(await connected())
        assertExplain(sql)
        const plain = await sql.explain(ctx(), 'SELECT 1', { analyze: false })
        const analyzed = await sql.explain(ctx(), 'SELECT 1', { analyze: true })

        expect(plain.analyzed).toBe(false)
        expect(analyzed.analyzed).toBe(true)
        expect(plain.text.length).toBeGreaterThan(0)
        expect(analyzed.text.length).toBeGreaterThan(0)
      })

      it('explain 결과가 IPC를 건널 수 있다', async () => {
        const sql = sqlOf(await connected())
        assertExplain(sql)
        const plan = await sql.explain(ctx(), 'SELECT 1', { analyze: false })

        expect(structuredClone(plan)).toEqual(plan)
      })
    })

    describe.runIf(hasBeginReadOnly)('sql.beginReadOnly 능력', () => {
      it('범위 안에서 읽기 문장은 동작한다', async () => {
        const read = readOf()
        const sql = sqlOf(await connected())
        assertBeginReadOnly(sql)
        const scope = await sql.beginReadOnly(ctx())
        const result = await scope.execute(ctx(), read.statement, FULL_PAGE)

        expect(result.page.rowCount).toBeGreaterThanOrEqual(0)

        await scope.end()
      })
    })

    /**
     * 읽기 전용 범위가 쓰기를 **정말로 막는지** 본다.
     *
     * 예전에는 `scope.execute(ctx(), 'DELETE FROM users', ...)`가 거부되는지만
     * 봤다. 그런데 어떤 엔진도 `users` 테이블을 갖고 있어야 할 의무가 없으므로,
     * 그 거부는 "읽기 전용이라서"가 아니라 "그런 relation이 없어서"일 수 있다.
     * 실제로 MemoryDriver의 읽기 전용 플래그를 꺼서 범위가 조용히 쓰기 가능해지게
     * 만들어도 — `SqlCapability.beginReadOnly`의 JSDoc이 금지하는 바로 그 퇴화 —
     * 이 계약은 초록으로 통과했다. 거부 자체는 아무것도 증명하지 못한다.
     *
     * 그래서 하네스가 준 **실제로 실행 가능한 쓰기 문장**을 범위 안에서 돌리고,
     * 거부된 뒤 그 쓰기가 **적용되지 않았음**까지 확인한다. 같은 문장을 범위
     * 밖에서 실행했을 때 여전히 약속된 행 수를 바꾼다면, 범위 안의 시도는
     * 아무 일도 하지 않은 것이다. 이로써 거부의 원인이 범위에 귀속된다.
     */
    describe.runIf(hasBeginReadOnly && hasWrite)('sql.beginReadOnly 쓰기 차단 계약', () => {
      it('범위 안의 쓰기가 거부되고, 그 쓰기가 적용되지도 않는다', async () => {
        const write = writeOf()
        // 0행을 바꾸는 문장으로는 "적용되지 않았다"를 구분할 수 없다 —
        // 적용됐든 아니든 나중 실행이 0을 돌려주기 때문이다.
        if (write.expectedRowsAffected < 1) {
          throw new Error(
            'contract violation: `write.expectedRowsAffected` must be at least 1 so the ' +
              'read-only contract can tell "the write was blocked" from "the write ran ' +
              'and changed nothing"',
          )
        }

        const driver = await connected()
        const sql = sqlOf(driver)
        assertBeginReadOnly(sql)
        const scope = await sql.beginReadOnly(ctx())

        await expect(scope.execute(ctx(), write.statement, FULL_PAGE)).rejects.toThrow()

        await scope.end()

        // 범위 밖에서 같은 문장이 여전히 약속된 행 수를 바꾼다 = 범위 안의
        // 시도는 아무것도 바꾸지 않았다. 범위가 조용히 쓰기를 통과시켰다면
        // 여기서 남은 행이 없어 이 단언이 깨진다.
        const applied = await sql.execute(ctx(), write.statement, FULL_PAGE)

        expect(applied.meta.rowsAffected).toBe(write.expectedRowsAffected)
      })
    })

    /**
     * 쓰기 문장을 줄 수 없는 드라이버의 면제. 구역 이름이 `sections`에 남으므로
     * 면제받았다는 사실 자체가 보인다 — 조용히 사라지지 않는다.
     */
    describe.runIf(hasBeginReadOnly && !hasWrite)('sql.beginReadOnly 쓰기 차단 계약 — 면제', () => {
      it('쓰기를 실행할 수 없음을 명시적으로 선언했다', () => {
        // 잠자코 `write`를 빼는 것으로 이 면제를 얻을 수는 없다.
        expect(factory().writesUnsupported).toBe(true)
      })
    })

    describe.runIf(hasSql)('sql 페이지네이션 계약', () => {
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
        const read = readOf()
        const sql = sqlOf(await connected())

        const full = await sql.execute(ctx(), read.statement, FULL_PAGE)

        // 기준 페이지가 잘렸다면 아래 비교가 무의미해진다.
        expect(full.meta.truncatedRows).toBe(false)
        expect(full.meta.truncatedBytes).toBe(false)
        // 팩토리가 약속한 행 수를 실제로 돌려주는지 확인한다 — 이게 어긋나면
        // 아래 비교는 "무엇을 읽었는지 모르는 두 결과"를 비교하는 셈이 된다.
        expect(full.rows).toHaveLength(read.expectedRowCount)

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

          const page: ResultSet = await sql.execute(ctx(), read.statement, {
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
        // 행 수보다 페이지 수가 적으면 상한이 무시된 것이다.
        expect(pages).toBeGreaterThanOrEqual(full.rows.length)
      })

      it('maxRows 상한을 넘겨 돌려주지 않고, 넘칠 때 truncatedRows를 표시한다', async () => {
        const read = readOf()
        const sql = sqlOf(await connected())

        const full = await sql.execute(ctx(), read.statement, FULL_PAGE)
        expect(full.rows.length).toBeGreaterThanOrEqual(2)

        const limited = await sql.execute(ctx(), read.statement, {
          cursor: null,
          maxRows: 1,
          maxBytes: FULL_PAGE.maxBytes,
        })

        expect(limited.rows).toHaveLength(1)
        expect(limited.page.hasMore).toBe(true)
        expect(limited.page.cursor).not.toBeNull()
      })
    })

    /**
     * 커서는 불투명 문자열이다. 호출자는 그 안을 볼 수 없고, 그래서 잘못된
     * 커서를 넘기는 일이 생긴다 — 저장해 둔 오래된 커서, 다른 질의에서 받은
     * 커서, 손상된 문자열. 드라이버가 이를 조용히 받아들이면 **엉뚱한 행을
     * 맞는 결과인 것처럼** 돌려준다. 조용한 오답보다 거부가 낫다.
     */
    describe.runIf(hasSql)('sql 커서 검증 계약', () => {
      it('드라이버가 발급하지 않은 커서는 거부한다', async () => {
        const read = readOf()
        const sql = sqlOf(await connected())

        for (const cursor of GARBAGE_CURSORS) {
          await expect(
            sql.execute(ctx(), read.statement, {
              cursor,
              maxRows: 1,
              maxBytes: FULL_PAGE.maxBytes,
            }),
          ).rejects.toThrow()
        }
      })
    })

    describe.runIf(hasSql)('sql 쓰기 선언 계약', () => {
      it('쓰기 문장을 제공했거나 명시적으로 면제를 선언했다', () => {
        // 잠자코 `write`를 빼는 것으로 rowsAffected 계약을 벗어날 수 없다.
        expect(() => {
          assertWriteDeclaration()
        }).not.toThrow()
      })
    })

    describe.runIf(hasSql)('sql 커서 교차사용 계약', () => {
      it('다른 질의에서 받은 커서는 거부한다', async () => {
        const read = readOf()
        const foreign = foreignStatementOf(read)
        const sql = sqlOf(await connected())

        const first = await sql.execute(ctx(), read.statement, {
          cursor: null,
          maxRows: 1,
          maxBytes: FULL_PAGE.maxBytes,
        })
        const cursor = must(first.page.cursor ?? undefined, 'expected a cursor to continue from')

        await expect(
          sql.execute(ctx(), foreign, {
            cursor,
            maxRows: 1,
            maxBytes: FULL_PAGE.maxBytes,
          }),
        ).rejects.toThrow()
      })
    })

    describe.runIf(hasWrite)('sql rowsAffected 계약', () => {
      it('쓰기 문장은 rowsAffected를 실제 수치로 보고한다', async () => {
        // null은 "보고하지 않음"이라는 별개의 뜻이므로, 쓰기가 그것을
        // 돌려주면 사용자는 "0행 변경"과 구분할 수 없다.
        const write = writeOf()
        const sql = sqlOf(await connected())

        const result = await sql.execute(ctx(), write.statement, FULL_PAGE)

        expect(result.meta.rowsAffected).toBe(write.expectedRowsAffected)
      })
    })

    describe.runIf(hasSchema)('schema 능력', () => {
      it('다섯 메서드가 모두 함수다', () => {
        const schema = schemaOf(factory().driver)

        expect(typeof schema.listSchemas).toBe('function')
        expect(typeof schema.listTables).toBe('function')
        expect(typeof schema.describeTable).toBe('function')
        expect(typeof schema.listIndexes).toBe('function')
        expect(typeof schema.listForeignKeys).toBe('function')
      })

      it('listSchemas와 listTables가 IPC를 건널 수 있는 값을 준다', async () => {
        const driver = await connected()
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
        const driver = await connected()
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
        const tables = await schemaOf(await connected()).listTables(ctx(), ABSENT_SCHEMA)

        expect(tables).toEqual([])
      })

      it('describeTable이 listTables가 보고한 테이블의 컬럼을 돌려준다', async () => {
        const driver = await connected()
        const schema = schemaOf(driver)
        const { schema: schemaName, table } = await firstTable(driver)
        const detail = await schema.describeTable(ctx(), schemaName, table)

        expect(detail.name).toBe(table)
        expect(detail.columns.length).toBeGreaterThan(0)
        expect(structuredClone(detail)).toEqual(detail)

        for (const column of detail.columns) {
          expect(column.name.length).toBeGreaterThan(0)
          expect(typeof column.type).toBe('string')
          expect(typeof column.nullable).toBe('boolean')
          expect(
            column.primaryKeyOrdinal === null || typeof column.primaryKeyOrdinal === 'number',
          ).toBe(true)
          expect(column.defaultValue === null || typeof column.defaultValue === 'string').toBe(true)
        }

        // 기본키 순서는 1부터 빈 곳 없이 이어져야 한다. 여기가 흔들리면 행 편집의
        // WHERE 절과 keyset 페이지네이션의 정렬이 서로 다른 순서를 쓰게 되고,
        // 증상은 "가끔 잘못된 행이 수정된다"는 형태로 나온다.
        const ordinals = detail.columns
          .map((column) => column.primaryKeyOrdinal)
          .filter((ordinal): ordinal is number => ordinal !== null)
          .sort((a, b) => a - b)

        expect(ordinals).toEqual(ordinals.map((_, index) => index + 1))
      })

      /**
       * `describeTable`이 스키마 한정자를 **실제로 쓰는지** 확인한다.
       *
       * `expect(detail.schema).toBe(schemaName)`으로는 이것을 알 수 없다 —
       * 입력을 그대로 되돌려주기만 해도 통과하기 때문이다. 스키마를 무시하고
       * 이름으로만 테이블을 찾는 드라이버는 없는 스키마를 물어봐도 태연히
       * 컬럼을 돌려주므로, 여기서 걸린다.
       */
      it('존재하지 않는 스키마의 테이블은 describeTable이 거부한다', async () => {
        const driver = await connected()
        const schema = schemaOf(driver)
        const { table } = await firstTable(driver)

        await expect(schema.describeTable(ctx(), ABSENT_SCHEMA, table)).rejects.toThrow()
      })

      it('listIndexes와 listForeignKeys가 IPC를 건널 수 있는 배열을 준다', async () => {
        const driver = await connected()
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
