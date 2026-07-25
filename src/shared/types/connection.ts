import { z } from 'zod'

export const ENGINE_IDS = [
  'postgres',
  'mysql',
  'mariadb',
  'sqlite',
  'mongodb',
  'redis',
  'dynamodb',
  'kafka',
  'rabbitmq',
] as const

export type EngineId = (typeof ENGINE_IDS)[number]

/**
 * 각 엔진이 **SQL 방언을 말하는가**.
 *
 * `satisfies Record<EngineId, boolean>` 이 핵심이다 — `ENGINE_IDS`에 엔진을
 * 하나 추가하면 이 표에 값을 채우기 전까지 **컴파일이 깨진다**. 침묵으로
 * 기본값이 정해지지 않게 하려는 것이다.
 *
 * 왜 필요한가: `StatementClassifier`의 `LEXICAL_DIALECTS`는 "지원하는 모든 SQL
 * 엔진을 담는다"는 완전성 가정 위에서만 건전하다. 과거에 `mariadb`가
 * `EngineId`에는 있는데 어휘 표에는 없어(MySQL로 뭉뚱그려져) `/*M!` 실행 주석
 * 계열 미탐이 생겼다. 그 부류의 표류를 테스트가 기계적으로 잡을 수 있도록
 * SQL 엔진 부분집합을 **여기 한 곳에서** 정의하고 소비자와 테스트가 함께
 * 파생하게 한다.
 */
export const ENGINE_IS_SQL = {
  postgres: true,
  mysql: true,
  mariadb: true,
  sqlite: true,
  mongodb: false,
  redis: false,
  dynamodb: false,
  kafka: false,
  rabbitmq: false,
} as const satisfies Record<EngineId, boolean>

/** SQL 방언을 말하는 엔진만 좁힌 타입. */
export type SqlEngineId = {
  [K in EngineId]: (typeof ENGINE_IS_SQL)[K] extends true ? K : never
}[EngineId]

/** `ENGINE_IS_SQL`에서 파생한다 — 손으로 두 번 적지 않는다. */
export const SQL_ENGINE_IDS: readonly SqlEngineId[] = ENGINE_IDS.filter(
  (id): id is SqlEngineId => ENGINE_IS_SQL[id],
)

/**
 * 각 엔진이 **드라이버가 구현되어 있는가**. `satisfies Record<EngineId, boolean>`가
 * 완전성을 강제한다 — `ENGINE_IDS`에 엔진을 추가하면 이 표를 채우기 전까지 컴파일이
 * 깨진다. UI(엔진 드롭다운)와 드리프트 가드 테스트가 여기서 파생한다.
 * 실제 드라이버 배선은 `src/main/app/registerDrivers.ts`이며, 그 등록 집합이 이 표와
 * 일치하는지 테스트로 강제한다.
 */
export const ENGINE_IMPLEMENTED = {
  postgres: true,
  mysql: true,
  mariadb: true,
  sqlite: true,
  mongodb: true,
  redis: true,
  dynamodb: true,
  kafka: true,
  rabbitmq: true,
} as const satisfies Record<EngineId, boolean>

/** `ENGINE_IMPLEMENTED`에서 파생 — 손으로 두 번 적지 않는다. */
export const IMPLEMENTED_ENGINE_IDS: readonly EngineId[] = ENGINE_IDS.filter(
  (id) => ENGINE_IMPLEMENTED[id],
)

export const TLS_MODES = ['disable', 'require', 'verify-ca', 'verify-full'] as const

export type TlsMode = (typeof TLS_MODES)[number]

/**
 * main이 AI 읽기 전용 계정의 **파생 커넥션**에 붙이는 접미사.
 *
 * 이 값은 main 내부의 풀 id 규약이면서 동시에 IPC 입력에서 **예약어**다. 그래서
 * shared에 둔다 — 파생 id를 만드는 쪽(main)과 renderer 입력을 거르는 쪽(계약)이
 * 같은 문자열을 봐야 하고, 두 벌로 적으면 한쪽만 바뀌는 순간 검사가 헐거워진다.
 */
export const DERIVED_CONNECTION_ID_SUFFIX = '::ai'

/**
 * IPC 경계를 넘어오는 커넥션 id.
 *
 * 파생 접미사로 끝나는 id를 **거부한다.** renderer가 `X::ai`를 보낼 수 있으면
 * 두 가지가 흐려진다: (1) 사용자 요청이 AI 전용 풀 entry에서 실행되고,
 * (2) 그런 id로 저장된 커넥션 설정이 다른 커넥션의 AI 비밀을 가리킨다
 * (`dbPasswordRefFor`가 접미사를 떼어 ownerId를 정하므로).
 *
 * 둘 다 권한 상승은 아니다 — AI 계정은 권한이 더 낮고, 제안서 소비는 원 커넥션
 * id로 대조되며 비밀 값은 renderer로 나가지 않는다. 그래도 거부하는 이유는
 * main 내부 이름 공간을 renderer가 지정할 수 있다는 상태 자체가 이후 변경에서
 * 조용히 실제 구멍으로 바뀌기 때문이다. 경계에서 한 번 막는 것이 싸다.
 */
export const connectionIdSchema = z
  .string()
  .min(1)
  .refine((id) => !id.endsWith(DERIVED_CONNECTION_ID_SUFFIX), {
    message: `connectionId must not end with the reserved suffix ${DERIVED_CONNECTION_ID_SUFFIX}`,
  })

/**
 * 커넥션 설정. **비밀을 담지 않는다.**
 * 비밀번호와 키는 SecretStore에 별도로 보관하며, 여기에는 참조만 남는다
 * (SecretRef.ownerId === ConnectionConfig.id).
 */
export const connectionConfigSchema = z.strictObject({
  // 저장되는 id도 파생 접미사를 쓸 수 없다 — 그런 설정이 저장되면 그 커넥션의
  // 드라이버가 다른 커넥션의 AI 비밀을 집어 든다.
  id: connectionIdSchema,
  name: z.string().min(1).max(200),
  engine: z.enum(ENGINE_IDS),
  host: z.string().max(255),
  port: z.number().int().min(0).max(65535),
  database: z.string().max(1024), // SQLite 파일 경로가 255를 넘을 수 있다(macOS 경로 최대 1024B)
  username: z.string().max(255),
  tlsMode: z.enum(TLS_MODES),
  /** AI 전용 읽기 계정. null이면 사용자 계정을 공유하며 UI가 경고를 표시한다. */
  aiReadOnlyUsername: z.string().max(255).nullable(),
  /** AI에 전달하기 전 마스킹할 컬럼 이름 패턴 */
  maskedColumnPatterns: z.array(z.string().max(100)).max(50),
})

export type ConnectionConfig = z.infer<typeof connectionConfigSchema>
