import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'
import { executeRead } from './executeRead'

/**
 * `kind: 'data'` 요청을 처리한다. 드라이버의 `data`가 SQL을 **안전하게 조립만**
 * 하고, 실행은 `executeRead`(sql 읽기 경로)로 넘긴다 — 그래야 AI 읽기 전용
 * 스코프 불변식이 sql·data 양쪽에서 한 곳(executeRead)에만 존재한다.
 */
export class DataCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'data' as const

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx, page } = input

    if (operation.kind !== 'data') {
      throw new Error(`DataCapabilityExecutor received ${operation.kind}`)
    }
    const data = driver.data
    if (data === undefined) throw new Error('driver does not support data')

    if (operation.op === 'apply') {
      const result = await data.applyChanges(ctx, operation.schema, operation.table, operation.changes)
      return { kind: 'applied', affected: result.affected }
    }

    // browse
    const sql = driver.sql
    if (sql === undefined) throw new Error('driver does not support sql')
    const built = data.buildBrowse(operation.schema, operation.table, operation.sort)
    const rows = await executeRead(sql, ctx, built.sql, page, built.params, input.readOnlyScope)
    return { kind: 'rows', rows }
  }
}
