import type { ExecutionLimits, Operation } from '../../../shared/types/operation'
import type { PageRequest, ResultSet } from '../../../shared/types/resultSet'
import type {
  SchemaInfo,
  TableDetail,
  TableInfo,
  IndexInfo,
  ForeignKeyInfo,
} from '../../../shared/types/schema'
import type { Driver } from '../driver/Driver'
import type { ExecutionContext } from '../driver/ExecutionContext'

/**
 * 실행 결과. 판별 유니온이라 호출자가 `kind`로 좁힌 뒤에만 내용을 본다.
 *
 * `ResultSet` 하나로 통일하지 않는 이유: 스키마 메타데이터를 행/컬럼으로 억지로
 * 감싸면 렌더러가 다시 풀어야 하고, 그 과정에서 타입이 사라진다.
 *
 * 모든 변형이 `structuredClone` 가능해야 한다 — IPC를 건넌다.
 */
export type OperationPayload =
  | { readonly kind: 'rows'; readonly rows: ResultSet }
  | { readonly kind: 'schemas'; readonly schemas: readonly SchemaInfo[] }
  | { readonly kind: 'tables'; readonly tables: readonly TableInfo[] }
  | { readonly kind: 'tableDetail'; readonly detail: TableDetail }
  | { readonly kind: 'indexes'; readonly indexes: readonly IndexInfo[] }
  | { readonly kind: 'foreignKeys'; readonly foreignKeys: readonly ForeignKeyInfo[] }

export interface CapabilityExecuteInput {
  readonly ctx: ExecutionContext
  readonly driver: Driver
  readonly operation: Operation
  readonly page: PageRequest
  readonly limits: ExecutionLimits
  /** true면 AI 경로다. 드라이버의 읽기 전용 스코프 안에서 실행해야 한다. */
  readonly readOnlyScope: boolean
}

/**
 * capability별 실행기. 엔진 문법 해석은 여기서, 공통 정책은 OperationExecutor에서.
 *
 * 나눠 두는 이유는 두 가지다. 하나는 OCP — document/keyvalue/stream capability가
 * 생길 때 관문을 건드리지 않고 실행기만 추가한다. 다른 하나가 더 중요한데,
 * **schema 연산이 sql 실행 경로에 닿을 수 없게 만드는 것**이다. 정책은 schema
 * 연산에 읽기 전용 스코프를 요구하지 않으므로(메타데이터는 데이터를 바꾸지
 * 않으니까), 만약 schema 요청이 어떤 경로로든 `sql.execute`로 흘러가면 AI가
 * 스코프 없이 임의 SQL을 돌리게 된다. 실행기를 `kind`로 분리해 두면 그 경로가
 * 우연히 생길 수 없다.
 */
export interface CapabilityExecutor {
  readonly kind: Operation['kind']
  execute(input: CapabilityExecuteInput): Promise<OperationPayload>
}
