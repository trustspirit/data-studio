import type { ExecutionContext } from '../ExecutionContext'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'

export interface KeyScanReq {
  readonly match?: string // SCAN MATCH glob 패턴(선택). 생략하면 '*'.
}

/**
 * 키-값 저장소(Redis) 능력. v1은 읽기 전용이다(scan/get).
 *
 * scan은 Redis 네이티브 SCAN 커서로 페이지네이션하며 `[key, type, ttl]` 컬럼을,
 * get은 한 키의 값을 타입별 정규화 JSON으로 `value` json 컬럼에 담는다.
 *
 * DocumentCapability의 `isReadOnlyPipeline`에 해당하는 방어 게이트가 **없다** —
 * scan/get은 구조적으로 읽기라 쓰기 벡터 자체가 없다. 임의 명령 실행(쓰기 가능)이
 * 생기면 그때 `classifyCommand`를 추가한다.
 */
export interface KeyValueCapability {
  scan(ctx: ExecutionContext, req: KeyScanReq, page: PageRequest): Promise<ResultSet>
  get(ctx: ExecutionContext, key: string, page: PageRequest): Promise<ResultSet>
}
