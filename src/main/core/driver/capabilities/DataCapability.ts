import type { BrowseSort, RowChange } from '../../../../shared/types/operation'
import type { ExecutionContext } from '../ExecutionContext'

/** 조립된 파라미터 바인딩 문장. 실행은 호출자(실행기)가 한다. */
export interface BuiltStatement {
  readonly sql: string
  readonly params: readonly unknown[]
}

export interface ApplyResult {
  readonly affected: number
}

/**
 * 테이블 데이터 접근. `buildBrowse`는 안전하게 **조립만** 한다(실행 안 함).
 * `applyChanges`는 편집을 **하나의 트랜잭션으로 원자 실행**한다 — 원자성은
 * 하나의 임차 연결 안에서만 성립하므로 조립/실행 분리 대신 여기서 실행한다.
 */
export interface DataCapability {
  buildBrowse(schema: string, table: string, sort?: BrowseSort): BuiltStatement
  applyChanges(
    ctx: ExecutionContext,
    schema: string,
    table: string,
    changes: readonly RowChange[],
  ): Promise<ApplyResult>
}
