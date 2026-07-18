import type { ZodType } from 'zod'
import type { InvokeEventLike } from '../security/senderGuard'
import type { Logger } from '../core/ports/Logger'

export type IpcFailureCode = 'forbidden_sender' | 'invalid_input'

export class IpcFailure extends Error {
  constructor(
    readonly code: IpcFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'IpcFailure'
  }
}

export interface RegistrarDeps {
  /** electron ipcMain.handle 어댑터 */
  handle(
    channel: string,
    handler: (event: InvokeEventLike, input: unknown) => Promise<unknown>,
  ): void
  guard(event: InvokeEventLike): boolean
  logger: Logger
}

export type RegisterHandler = <I, O>(
  channel: string,
  schema: ZodType<I>,
  handler: (input: I) => Promise<O>,
) => void

/**
 * 모든 IPC 핸들러가 통과하는 단일 등록 지점.
 * sender 검증 → 스키마 검증 → 핸들러 순으로 게이트를 건다.
 * 핸들러는 검증된 입력만 보므로 자체 방어 코드를 둘 필요가 없다.
 */
export function createHandlerRegistrar(deps: RegistrarDeps): RegisterHandler {
  return (channel, schema, handler) => {
    deps.handle(channel, async (event, input) => {
      if (!deps.guard(event)) {
        deps.logger.warn('ipc.forbidden_sender', {
          channel,
          senderUrl: event.senderFrame?.url ?? null,
        })
        throw new IpcFailure('forbidden_sender', `sender rejected for ${channel}`)
      }

      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        deps.logger.warn('ipc.invalid_input', {
          channel,
          issues: parsed.error.issues.map((i) => i.path.join('.')),
        })
        throw new IpcFailure('invalid_input', `invalid input for ${channel}`)
      }

      return handler(parsed.data)
    })
  }
}
