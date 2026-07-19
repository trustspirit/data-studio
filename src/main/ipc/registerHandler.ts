import type { ZodType } from 'zod'
import type { InvokeEventLike } from '../security/senderGuard'
import type { Logger } from '../core/ports/Logger'
import type { CallerContext } from './CallerContext'
import type { IpcFailureCode, IpcResult } from '../../shared/contracts/ipcResult'
import {
  IPC_CONTRACT,
  type ContractChannel,
  type ContractInput,
} from '../../shared/contracts/ipcContract'

export type { IpcFailureCode, IpcResult }

/**
 * main 내부의 제어 흐름용 오류. IPC 경계를 넘지 않는다 —
 * 경계를 넘는 것은 항상 `IpcResult`다.
 */
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
 *
 * 실패는 던지지 않고 `{ ok: false, code }`로 반환한다. 자세한 이유는
 * `shared/contracts/ipcResult.ts` 참고.
 */
/**
 * 계약 표를 강제하는 register. 채널을 받고, **그 채널에 묶인 스키마를 표에서
 * 꺼내** 쓴다. 호출부가 스키마를 넘길 수 없으므로 채널에 엉뚱한 스키마를 붙일
 * 수 없고, 핸들러의 입력 타입도 표에서 유도되어 채널 A의 핸들러가 채널 B의
 * 입력을 기대하면 타입 에러가 난다.
 */
export function createContractRegistrar(
  deps: RegistrarDeps,
): <C extends ContractChannel, O>(
  channel: C,
  handler: (input: ContractInput<C>, context: CallerContext) => Promise<O>,
) => void {
  const register = createHandlerRegistrar(deps)
  return <C extends ContractChannel, O>(
    channel: C,
    handler: (input: ContractInput<C>, context: CallerContext) => Promise<O>,
  ): void => {
    // 제네릭 `C`에서 `IPC_CONTRACT[C]['input']`은 모든 채널 스키마의 유니온으로
    // 넓어져 컴파일러가 `ContractInput<C>`와 못 맞춘다. 표가 `satisfies`로
    // 채널→스키마 관계를 이미 보장하므로, 그 불변식을 이 한 지점에서만
    // 좁혀 준다 — 타입을 넓히는 것이 아니라 증명된 관계를 명시하는 것이다.
    const schema = IPC_CONTRACT[channel].input as unknown as ZodType<ContractInput<C>>
    register(channel, schema, handler)
  }
}

export function createHandlerRegistrar(deps: RegistrarDeps): RegisterHandler {
  return (channel, schema, handler) => {
    deps.handle(channel, async (event, input) => {
      if (!deps.guard(event)) {
        deps.logger.warn('ipc.forbidden_sender', {
          channel,
          senderUrl: event.senderFrame?.url ?? null,
        })
        return { ok: false, code: 'forbidden_sender' }
      }

      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        deps.logger.warn('ipc.invalid_input', {
          channel,
          issues: parsed.error.issues.map((i) => i.path.join('.')),
        })
        return { ok: false, code: 'invalid_input' }
      }

      try {
        return { ok: true, value: await handler(parsed.data, buildCallerContext()) }
      } catch (error) {
        // 핸들러가 도메인 수준 거부를 IpcFailure로 표현했다면 그 코드를 그대로 쓴다.
        if (error instanceof IpcFailure) {
          return { ok: false, code: error.code }
        }

        // 예상치 못한 예외의 메시지는 renderer로 넘기지 않는다 — 커넥션 문자열,
        // 파일 경로, 스키마 내부 구조가 섞여 나올 수 있다. main 로그에만 남긴다.
        deps.logger.warn('ipc.unexpected_error', {
          channel,
          message: error instanceof Error ? error.message : String(error),
        })
        return { ok: false, code: 'internal_error' }
      }
    })
  }
}
