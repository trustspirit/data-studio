import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'
import { executeRead } from './executeRead'

/**
 * `kind: 'sql'` 요청을 드라이버의 sql capability로 옮긴다.
 *
 * 이 클래스는 정책을 판단하지 않는다 — 무엇을 허용할지는 `ExecutionPolicy`가
 * 이미 정했고, 여기서는 그 결정(`readOnlyScope`)을 `executeRead`로 집행한다.
 */
export class SqlCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'sql' as const

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx, page } = input

    if (operation.kind !== 'sql') {
      throw new Error(`SqlCapabilityExecutor received ${operation.kind}`)
    }

    const sql = driver.sql
    if (sql === undefined) throw new Error('driver does not support sql')

    const rows = await executeRead(sql, ctx, operation.sql, page, operation.params, input.readOnlyScope)
    return { kind: 'rows', rows }
  }
}
