import { z, type ZodType } from 'zod'
import { connectionConfigSchema } from '../types/connection'
import { operationRequestSchema } from './operationDto'

/**
 * IPC 채널 → 입력 스키마의 **단일 표.**
 *
 * register 호출부가 `(channel, schema, handler)`를 자유롭게 넘기면, 채널 A에
 * 실수로 채널 B의 스키마를 붙이는 것을 아무도 막지 못한다(loose-schema). 채널을
 * 이 표에서 고르고 스키마를 표에서 강제로 꺼내 쓰면, 그 실수가 타입 에러가 된다.
 *
 * preload의 화이트리스트도 이 표에서 유도해, 채널 목록이 두 곳에서 어긋나지
 * 않게 한다.
 */
export const IPC_CONTRACT = {
  'connection:list': { input: z.undefined() },
  'connection:save': { input: connectionConfigSchema },
  'connection:delete': { input: z.object({ id: z.string().min(1) }) },
  'secrets:status': { input: z.undefined() },
  'secrets:set': {
    input: z.object({ connectionId: z.string().min(1), value: z.string().min(1).max(4096) }),
  },
  'secrets:has': { input: z.object({ connectionId: z.string().min(1) }) },
  'operation:run': { input: operationRequestSchema },
  'operation:cancel': { input: z.object({ requestId: z.string().min(1) }) },
  'audit:recent': { input: z.object({ limit: z.number().int() }) },
} as const satisfies Record<string, { readonly input: ZodType }>

export type ContractChannel = keyof typeof IPC_CONTRACT

export type ContractInput<C extends ContractChannel> = z.infer<(typeof IPC_CONTRACT)[C]['input']>

export function contractChannels(): ContractChannel[] {
  return Object.keys(IPC_CONTRACT) as ContractChannel[]
}
