import type { OperationRequestDto } from '../../../shared/contracts/operationDto'
import type { ResultSet } from '../../../shared/types/resultSet'
import type {
  SchemaInfo,
  TableInfo,
  TableDetail,
  IndexInfo,
  ForeignKeyInfo,
} from '../../../shared/types/schema'

/**
 * 실행 결과의 renderer 표현. main의 `OperationResult`를 그대로 받는다.
 *
 * main 타입을 재선언하지 않고 여기서 얇게 다시 적는다 — renderer는 main을
 * import하지 않으므로(boundaries 테스트가 강제) 구조만 맞춘다. `rows`는
 * `ResultSet`(shared)이다 — main의 실제 페이로드와 구조가 같다.
 */
export type OperationPayload =
  | { readonly kind: 'rows'; readonly rows: ResultSet }
  | { readonly kind: 'schemas'; readonly schemas: readonly SchemaInfo[] }
  | { readonly kind: 'tables'; readonly tables: readonly TableInfo[] }
  | { readonly kind: 'tableDetail'; readonly detail: TableDetail }
  | { readonly kind: 'indexes'; readonly indexes: readonly IndexInfo[] }
  | { readonly kind: 'foreignKeys'; readonly foreignKeys: readonly ForeignKeyInfo[] }
  | { readonly kind: 'applied'; readonly affected: number }

export type OperationOutcome =
  | { readonly ok: true; readonly payload: OperationPayload }
  | { readonly ok: false; readonly reason: string }

/**
 * 감사 로그 항목의 renderer 뷰. main의 `OperationLogEntry`가 IPC로 넘어온 형태를
 * 구조만 맞춰 다시 적는다 — renderer는 main을 import하지 않는다.
 */
export interface AuditEntry {
  readonly requestId: string
  readonly connectionId: string
  readonly actorType: 'user' | 'ai'
  readonly actorId: string | null
  readonly statement: string
  readonly outcome: string
  readonly at: number
}

/**
 * feature가 데이터 실행·취소·감사 조회에 의존하는 인터페이스.
 *
 * `run`의 요청에는 `actor`가 없다 — 권한은 main이 정한다. 승인 토큰(`proposalId`)만
 * 실어 보낸다.
 */
export interface OperationGateway {
  run(request: OperationRequestDto): Promise<OperationOutcome>
  cancel(requestId: string): Promise<void>
  recentAudit(limit: number): Promise<readonly AuditEntry[]>
}
