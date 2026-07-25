import type { ExecutionContext } from '../ExecutionContext'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'

export interface DynamoScanReq {
  readonly table: string
}

export interface DynamoPartiqlReq {
  readonly statement: string
}

/**
 * 와이드컬럼 저장소(DynamoDB) 능력. 결과는 한 행=아이템 하나, `_item` json 컬럼
 * (unmarshall + normalizeItem으로 JSON 무손실)에 담는다.
 *
 * v1은 읽기 전용이다(listTables/scan/partiql). `isReadOnlyStatement`는 비-SELECT
 * PartiQL(INSERT/UPDATE/DELETE)을 거부하는 판정으로, DocumentCapability의
 * `isReadOnlyPipeline`과 같은 역할을 PartiQL 문법에 대해 수행한다. 파티션/정렬
 * 키 조회는 별도 op 없이 `SELECT ... WHERE`로 표현한다.
 */
export interface DynamoCapability {
  listTables(ctx: ExecutionContext, page: PageRequest): Promise<ResultSet>
  scan(ctx: ExecutionContext, req: DynamoScanReq, page: PageRequest): Promise<ResultSet>
  partiql(ctx: ExecutionContext, req: DynamoPartiqlReq, page: PageRequest): Promise<ResultSet>
  isReadOnlyStatement(statement: string): boolean
}
