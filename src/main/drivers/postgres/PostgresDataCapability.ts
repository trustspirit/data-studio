import type { BrowseSort } from '../../../shared/types/operation'
import type { BuiltStatement, DataCapability } from '../../core/driver/capabilities/DataCapability'

/** PostgreSQL 식별자 인용. 내부 큰따옴표는 이중화한다 — 인젝션 방지의 핵심. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export class PostgresDataCapability implements DataCapability {
  buildBrowse(schema: string, table: string, sort?: BrowseSort): BuiltStatement {
    const target = `${quoteIdent(schema)}.${quoteIdent(table)}`
    // direction은 타입 유니온이라 임의 문자열이 들어올 수 없다 — 고정 키워드만 쓴다.
    const order =
      sort === undefined
        ? ''
        : ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    return { sql: `SELECT * FROM ${target}${order}`, params: [] }
  }
}
