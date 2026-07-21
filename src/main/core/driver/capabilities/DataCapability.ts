import type { BrowseSort } from '../../../../shared/types/operation'

/** 조립된 파라미터 바인딩 문장. 실행은 호출자(실행기)가 한다. */
export interface BuiltStatement {
  readonly sql: string
  readonly params: readonly unknown[]
}

/**
 * 테이블 데이터 접근을 위한 **안전한 SQL 조립**. 실행하지 않는다 — 문자열과
 * 파라미터만 돌려준다. 식별자 인용은 드라이버가 dialect에 맞춰 책임진다
 * (renderer가 식별자를 인용하면 인젝션 통로가 되므로 여기서 한다).
 *
 * 사이클 2에서 `buildApply(...)`(트랜잭션 편집)가 순수 확장으로 추가된다.
 */
export interface DataCapability {
  buildBrowse(schema: string, table: string, sort?: BrowseSort): BuiltStatement
}
