import type { ExecutionContext } from '../ExecutionContext'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'

export interface DocumentFindReq {
  readonly collection: string
  readonly filter?: string // EJSON
  readonly sort?: string // EJSON
  readonly limit?: number
}

export interface DocumentAggregateReq {
  readonly collection: string
  readonly pipeline: string // EJSON array
}

/**
 * 문서 저장소(MongoDB) 능력. 결과는 한 행=문서 하나, `_doc` json 컬럼(EJSON, BSON
 * 무손실)에 담는다.
 *
 * v1은 읽기 전용이다(find/aggregate/listCollections). `isReadOnlyPipeline`은
 * 데이터를 바꾸는 스테이지($out/$merge 등)가 섞인 파이프라인을 거부하는 판정이다
 * — SqlCapability의 `classify`와 같은 역할을, aggregation 파이프라인이라는
 * 다른 문법에 대해 수행한다.
 */
export interface DocumentCapability {
  listCollections(ctx: ExecutionContext, page: PageRequest): Promise<ResultSet>
  find(ctx: ExecutionContext, req: DocumentFindReq, page: PageRequest): Promise<ResultSet>
  aggregate(ctx: ExecutionContext, req: DocumentAggregateReq, page: PageRequest): Promise<ResultSet>
  isReadOnlyPipeline(pipeline: string): boolean
}
