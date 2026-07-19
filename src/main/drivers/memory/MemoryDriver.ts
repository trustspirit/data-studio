import type { ConnectionConfig, EngineId } from '../../../shared/types/connection'
import {
  buildResultSet,
  type ColumnDescriptor,
  type PageRequest,
  type ResultSet,
} from '../../../shared/types/resultSet'
import { wire, type WireValue } from '../../../shared/types/wire'
import type { Driver } from '../../core/driver/Driver'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type {
  ExplainOptions,
  ExplainPlan,
  ReadOnlyScope,
  SqlCapability,
  StatementClassification,
} from '../../core/driver/capabilities/SqlCapability'
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  SchemaCapability,
  SchemaInfo,
  TableDetail,
  TableInfo,
  TableKind,
} from '../../core/driver/capabilities/SchemaCapability'

export interface MemoryTable {
  readonly schema: string
  readonly name: string
  /** 생략하면 `'table'`. */
  readonly kind?: TableKind
  readonly columns: readonly ColumnInfo[]
  /** 원시 JS 값. 드라이버가 WireValue로 정규화한다. */
  readonly rows: readonly (readonly unknown[])[]
  readonly indexes?: readonly IndexInfo[]
  readonly foreignKeys?: readonly ForeignKeyInfo[]
}

export interface MemorySeed {
  readonly tables: readonly MemoryTable[]
}

const READ_PREFIXES = ['select', 'explain', 'show', 'with']
const WRITE_PREFIXES = [
  'insert',
  'update',
  'delete',
  'drop',
  'create',
  'alter',
  'truncate',
  'grant',
  'revoke',
]

/** 커서 문자열의 접두사. 다른 드라이버/다른 질의의 커서를 흘려받지 않기 위한 표식. */
const CURSOR_PREFIX = 'mem:1:'

function classify(sql: string): StatementClassification {
  const head = sql.trim().toLowerCase()
  if (head.length === 0) return 'unknown'
  if (READ_PREFIXES.some((p) => head.startsWith(p))) return 'read'
  if (WRITE_PREFIXES.some((p) => head.startsWith(p))) return 'write'
  return 'unknown'
}

function toWireValue(raw: unknown): WireValue {
  if (raw === null || raw === undefined) return wire.null()
  if (typeof raw === 'boolean') return wire.bool(raw)
  if (typeof raw === 'bigint') return wire.bigint(raw)
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? wire.int(raw) : wire.float(raw)
  }
  if (typeof raw === 'string') return wire.str(raw)
  if (raw instanceof Date) return wire.date(raw)
  if (raw instanceof Uint8Array) return wire.bytes(raw)
  if (typeof raw === 'object') return wire.json(JSON.stringify(raw))
  return wire.unknown('', `unsupported memory value: ${typeof raw}`)
}

/** SQL에서 읽어낸 테이블 참조. `schema`는 한정자가 없으면 null. */
interface TableRef {
  readonly schema: string | null
  readonly table: string
}

/** SQL을 파싱하지 않고 `FROM <table>`만 읽는다. 따옴표는 벗기되 스키마 한정자는 **살린다**. */
function tableRefFrom(sql: string): TableRef | null {
  const match = /\bfrom\s+([a-z0-9_."]+)/i.exec(sql)
  const raw = match?.[1]
  if (raw === undefined) return null

  const parts = raw.replaceAll('"', '').split('.')
  const table = parts[parts.length - 1]
  if (table === undefined || table.length === 0) return null

  const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined
  return { schema: schema === undefined || schema.length === 0 ? null : schema, table }
}

/**
 * 커서는 "어느 스키마의 어느 테이블에서 몇 번째 행부터"를 담는다.
 *
 * 스키마까지 실어 두는 이유: 이름이 같고 스키마가 다른 테이블(`public.users`와
 * `analytics.users`)이 흔하다. 테이블 이름만 실으면 한쪽에서 받은 커서가
 * 다른 쪽 질의에 그대로 먹혀서, 거부되어야 할 요청이 조용히 **엉뚱한 행**을
 * 돌려준다. 오프셋 커서를 쓰기로 한 근거 자체가 "다른 질의의 커서를 거부할 수
 * 있다"였으므로, 신원에 스키마가 빠지면 그 근거가 무너진다.
 */
function tableIdentity(table: TableState): string {
  return `${table.schema}.${table.name}`
}

function encodeCursor(table: TableState, offset: number): string {
  return `${CURSOR_PREFIX}${offset}:${tableIdentity(table)}`
}

function decodeCursor(cursor: string, table: TableState): number {
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new Error(`malformed cursor: ${cursor}`)
  }

  const body = cursor.slice(CURSOR_PREFIX.length)
  const separator = body.indexOf(':')
  if (separator < 0) {
    throw new Error(`malformed cursor: ${cursor}`)
  }

  const offset = Number(body.slice(0, separator))
  const cursorTable = body.slice(separator + 1)
  const identity = tableIdentity(table)

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`malformed cursor: ${cursor}`)
  }
  if (cursorTable !== identity) {
    throw new Error(`cursor belongs to table '${cursorTable}', not '${identity}'`)
  }

  return offset
}

function assertNotAborted(ctx: ExecutionContext): void {
  if (ctx.signal.aborted) {
    throw new Error(`execution aborted: ${ctx.requestId}`)
  }
}

interface TableState {
  readonly schema: string
  readonly name: string
  readonly kind: TableKind
  readonly columns: readonly ColumnInfo[]
  readonly indexes: readonly IndexInfo[]
  readonly foreignKeys: readonly ForeignKeyInfo[]
  rows: readonly (readonly unknown[])[]
}

/**
 * 실제 엔진 없이 상위 계층을 검증하기 위한 인메모리 드라이버.
 *
 * 프로덕션 경로가 아니다 — 계약 스위트가 실제로 무언가를 검증하도록 만들고,
 * Phase 0b-2의 OperationExecutor가 Testcontainers 없이 개발될 수 있게 한다.
 * SQL을 파싱하지 않고 `FROM <table>`만 읽으며, 쓰기는 `DELETE FROM <table>`
 * 하나만 지원한다 — 그 이상은 조용히 성공한 척하지 않고 던진다.
 */
class MemoryDriverImpl implements Driver {
  readonly id: string
  readonly engine: EngineId
  readonly sql: SqlCapability
  readonly schema: SchemaCapability

  private readonly tables: readonly TableState[]

  constructor(config: ConnectionConfig, seed: MemorySeed) {
    this.id = config.id
    this.engine = config.engine
    this.tables = seed.tables.map((table) => ({
      schema: table.schema,
      name: table.name,
      kind: table.kind ?? 'table',
      columns: table.columns,
      indexes: table.indexes ?? [],
      foreignKeys: table.foreignKeys ?? [],
      rows: table.rows,
    }))

    this.sql = {
      execute: (ctx, statement, page) => this.execute(ctx, statement, page, false),
      explain: (ctx, statement, opts) => this.explain(ctx, statement, opts),
      beginReadOnly: (ctx) => this.beginReadOnly(ctx),
      classify,
    }

    this.schema = {
      listSchemas: (ctx) => this.listSchemas(ctx),
      listTables: (ctx, schema) => this.listTables(ctx, schema),
      describeTable: (ctx, schema, table) => this.describeTable(ctx, schema, table),
      listIndexes: (ctx, schema, table) =>
        this.metadataOf(ctx, schema, table, (found) => found.indexes),
      listForeignKeys: (ctx, schema, table) =>
        this.metadataOf(ctx, schema, table, (found) => found.foreignKeys),
    }
  }

  connect(): Promise<void> {
    return Promise.resolve()
  }

  disconnect(): Promise<void> {
    return Promise.resolve()
  }

  ping(): Promise<number> {
    return Promise.resolve(0)
  }

  /**
   * 스키마 한정자가 있으면 **그 스키마 안에서만** 찾는다.
   *
   * 한정자를 무시하고 이름으로만 찾으면 `SELECT * FROM analytics.users`가
   * `public.users`의 컬럼과 행을 돌려준다 — 틀린 답을 맞는 답처럼 주는 셈이다.
   * 한정자가 없는데 같은 이름이 여러 스키마에 있으면, 아무거나 고르지 않고
   * 모호하다고 던진다.
   */
  private findTable(ref: TableRef): TableState {
    if (ref.schema !== null) {
      const qualified = this.tables.find((t) => t.schema === ref.schema && t.name === ref.table)
      if (qualified === undefined) {
        throw new Error(`unknown table: ${ref.schema}.${ref.table}`)
      }
      return qualified
    }

    const matches = this.tables.filter((t) => t.name === ref.table)
    const first = matches[0]
    if (first === undefined) throw new Error(`unknown table: ${ref.table}`)
    if (matches.length > 1) {
      throw new Error(
        `ambiguous table reference '${ref.table}': ` +
          `qualify it with one of ${matches.map((t) => t.schema).join(', ')}`,
      )
    }
    return first
  }

  private execute(
    ctx: ExecutionContext,
    statement: string,
    page: PageRequest,
    readOnly: boolean,
  ): Promise<ResultSet> {
    try {
      assertNotAborted(ctx)

      const classification = classify(statement)

      // 'unknown'은 fail-safe로 쓰기 취급한다 — 읽기 전용 범위 안에서는
      // 확신할 수 없는 문장을 통과시키면 안 된다.
      if (readOnly && classification !== 'read') {
        throw new Error(`read-only scope rejected a non-read statement: ${statement}`)
      }

      if (classification === 'write') {
        return Promise.resolve(this.executeWrite(ctx, statement, page))
      }

      return Promise.resolve(this.executeRead(ctx, statement, page))
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /** 지원하는 쓰기는 WHERE 없는 `DELETE FROM <table>` 뿐이다. */
  private executeWrite(ctx: ExecutionContext, statement: string, page: PageRequest): ResultSet {
    const deleteMatch = /^\s*delete\s+from\s+([a-z0-9_."]+)\s*;?\s*$/i.exec(statement)
    if (deleteMatch === null) {
      throw new Error(`unsupported write statement for the memory driver: ${statement}`)
    }

    const ref = tableRefFrom(statement)
    if (ref === null) {
      throw new Error(`unsupported write statement for the memory driver: ${statement}`)
    }

    const table = this.findTable(ref)
    const removed = table.rows.length
    table.rows = []

    return buildResultSet({
      requestId: ctx.requestId,
      columns: [],
      rows: [],
      page,
      durationMs: 0,
      cursorAt: () => null,
      rowsAffected: removed,
    })
  }

  private executeRead(ctx: ExecutionContext, statement: string, page: PageRequest): ResultSet {
    const ref = tableRefFrom(statement)

    if (ref === null) {
      // FROM 절이 없는 문장(SELECT 1 등)은 빈 결과로 취급한다.
      // 커서를 받았다면 어디에도 대응하지 않으므로 거부한다.
      if (page.cursor !== null) {
        throw new Error(`malformed cursor: ${page.cursor}`)
      }

      return buildResultSet({
        requestId: ctx.requestId,
        columns: [],
        rows: [],
        page,
        durationMs: 0,
        cursorAt: () => null,
      })
    }

    const table = this.findTable(ref)
    const offset = page.cursor === null ? 0 : decodeCursor(page.cursor, table)
    const remaining = table.rows.slice(offset)
    const columns: readonly ColumnDescriptor[] = table.columns.map((c) => ({
      name: c.name,
      type: c.type,
    }))

    return buildResultSet({
      requestId: ctx.requestId,
      columns,
      rows: remaining.map((row) => row.map(toWireValue)),
      page,
      durationMs: 0,
      // `buildResultSet`은 상한을 적용해 **실제로 담은** 행 수로 이 콜백을
      // 부른다. 그래서 여기서 계산한 커서는 항상 "돌려준 마지막 행 다음"을
      // 가리키고, 잘려나간 행이 있어도 다음 요청이 그 행부터 이어 읽는다.
      cursorAt: (kept) => {
        const next = offset + kept
        return next < table.rows.length ? encodeCursor(table, next) : null
      },
    })
  }

  private explain(
    ctx: ExecutionContext,
    statement: string,
    opts: ExplainOptions,
  ): Promise<ExplainPlan> {
    try {
      assertNotAborted(ctx)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }

    return Promise.resolve({
      text: `memory plan for: ${statement}`,
      analyzed: opts.analyze,
    })
  }

  private beginReadOnly(ctx: ExecutionContext): Promise<ReadOnlyScope> {
    try {
      assertNotAborted(ctx)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }

    return Promise.resolve({
      execute: (scopeCtx, statement, page) => this.execute(scopeCtx, statement, page, true),
      end: () => Promise.resolve(),
    })
  }

  private listSchemas(ctx: ExecutionContext): Promise<readonly SchemaInfo[]> {
    try {
      assertNotAborted(ctx)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }

    const names = [...new Set(this.tables.map((t) => t.schema))]
    return Promise.resolve(names.map((name) => ({ name })))
  }

  private listTables(ctx: ExecutionContext, schema: string): Promise<readonly TableInfo[]> {
    try {
      assertNotAborted(ctx)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }

    return Promise.resolve(
      this.tables
        .filter((t) => t.schema === schema)
        .map((t) => ({
          schema: t.schema,
          name: t.name,
          kind: t.kind,
          estimatedRows: t.rows.length,
        })),
    )
  }

  private describeTable(
    ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<TableDetail> {
    try {
      assertNotAborted(ctx)

      const found = this.tables.find((t) => t.schema === schema && t.name === table)
      if (found === undefined) throw new Error(`unknown table: ${schema}.${table}`)

      return Promise.resolve({ schema, name: table, columns: found.columns })
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private metadataOf<T>(
    ctx: ExecutionContext,
    schema: string,
    table: string,
    pick: (found: TableState) => readonly T[],
  ): Promise<readonly T[]> {
    try {
      assertNotAborted(ctx)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }

    const found = this.tables.find((t) => t.schema === schema && t.name === table)
    return Promise.resolve(found === undefined ? [] : pick(found))
  }
}

/**
 * 기본 시드.
 *
 * 계약 스위트의 페이지네이션 구역이 커서 전진을 실제로 확인할 수 있도록
 * 2행 이상을 담는다 — 1행짜리 데이터셋으로는 커서가 전진하는 드라이버와
 * 매번 같은 페이지를 돌려주는 드라이버를 구분할 수 없다.
 *
 * **이름이 같고 스키마가 다른 테이블을 일부러 둘 담는다.** 스키마를 무시하고
 * 이름으로만 테이블을 찾는 구현, 그리고 커서 신원에 스키마를 넣지 않은 구현이
 * 계약 스위트에서 걸리게 하기 위해서다. 두 테이블은 컬럼과 행 수가 서로 달라서,
 * 잘못 고르면 결과가 눈에 띄게 달라진다.
 */
const DEFAULT_SEED: MemorySeed = {
  tables: [
    {
      schema: 'public',
      name: 'contract_probe',
      kind: 'table',
      columns: [
        { name: 'id', type: 'int8', nullable: false, defaultValue: null, isPrimaryKey: true },
        { name: 'label', type: 'text', nullable: true, defaultValue: null, isPrimaryKey: false },
      ],
      rows: [
        [1, 'one'],
        [2, 'two'],
        [3, null],
      ],
      indexes: [{ name: 'contract_probe_pkey', columns: ['id'], unique: true, sizeBytes: null }],
      foreignKeys: [],
    },
    {
      schema: 'analytics',
      name: 'contract_probe',
      kind: 'table',
      columns: [
        { name: 'bucket', type: 'text', nullable: false, defaultValue: null, isPrimaryKey: true },
      ],
      rows: [['a'], ['b']],
      indexes: [],
      foreignKeys: [],
    },
  ],
}

export function createMemoryDriver(config: ConnectionConfig, seed: MemorySeed = DEFAULT_SEED): Driver {
  return new MemoryDriverImpl(config, seed)
}
