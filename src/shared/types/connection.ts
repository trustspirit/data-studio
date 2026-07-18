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

export const TLS_MODES = ['disable', 'require', 'verify-ca', 'verify-full'] as const

export type TlsMode = (typeof TLS_MODES)[number]

/**
 * 커넥션 설정. **비밀을 담지 않는다.**
 * 비밀번호와 키는 SecretStore에 별도로 보관하며, 여기에는 참조만 남는다
 * (SecretRef.ownerId === ConnectionConfig.id).
 */
export const connectionConfigSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  engine: z.enum(ENGINE_IDS),
  host: z.string().max(255),
  port: z.number().int().min(0).max(65535),
  database: z.string().max(255),
  username: z.string().max(255),
  tlsMode: z.enum(TLS_MODES),
  /** AI 전용 읽기 계정. null이면 사용자 계정을 공유하며 UI가 경고를 표시한다. */
  aiReadOnlyUsername: z.string().max(255).nullable(),
  /** AI에 전달하기 전 마스킹할 컬럼 이름 패턴 */
  maskedColumnPatterns: z.array(z.string().max(100)).max(50),
})

export type ConnectionConfig = z.infer<typeof connectionConfigSchema>
