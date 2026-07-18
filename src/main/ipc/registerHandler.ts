import type { ZodType } from 'zod'
import type { InvokeEventLike } from '../security/senderGuard'
import type { Logger } from '../core/ports/Logger'
import type { CallerContext } from './CallerContext'

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
  handler: (input: I, context: CallerContext) => Promise<O>,
) => void

/**
 * 호출자 컨텍스트를 main 프로세스 상태만으로 구성한다. `event`나 `input`을
 * 참조하지 않는다 — renderer가 보낸 어떤 값도 여기 섞이면 안 된다.
 * 이 단계에서는 모든 IPC 호출이 preload를 통해서만 들어오므로 항상
 * 'renderer-ui'다. 나중에 AI가 직접 커맨드를 발행하는 경로가 생기면
 * 이 함수 안에서 main이 아는 사실(예: 어느 큐/브릿지를 통해 들어왔는지)로
 * 판단을 넓히면 되고, register() 호출부는 손댈 필요가 없다.
 */
function buildCallerContext(): CallerContext {
  return { source: 'renderer-ui' }
}

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

      return handler(parsed.data, buildCallerContext())
    })
  }
}
