import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'

/**
 * `kind: 'sql'` 요청을 드라이버의 sql capability로 옮긴다.
 *
 * 이 클래스는 정책을 판단하지 않는다 — 무엇을 허용할지는 `ExecutionPolicy`가
 * 이미 정했고, 여기서는 그 결정(`readOnlyScope`)을 그대로 집행한다.
 */
export class SqlCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'sql' as const

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx, page } = input

    if (operation.kind !== 'sql') {
      // 관문이 kind로 실행기를 고르므로 여기 올 수 없다. 그래도 막는다 —
      // 배선이 잘못되면 조용히 엉뚱한 문장을 실행하는 대신 터져야 한다.
      throw new Error(`SqlCapabilityExecutor received ${operation.kind}`)
    }

    const sql = driver.sql
    if (sql === undefined) throw new Error('driver does not support sql')

    if (!input.readOnlyScope) {
      return { kind: 'rows', rows: await sql.execute(ctx, operation.sql, page, operation.params) }
    }

    if (sql.beginReadOnly === undefined) {
      // 정책이 이미 걸러야 하지만 여기서도 막는다. 조용히 일반 실행으로
      // 대체하면 AI 읽기 전용 보장이 무너진 채 안전해 보인다 — 이 앱에서
      // 가장 피하고 싶은 형태의 실패다.
      throw new Error('driver does not support a read-only scope')
    }

    // sql.beginReadOnly를 지역 변수로 떼어내 호출하면 `this`가 끊긴다.
    // 드라이버 구현이 자기 상태를 참조할 수 있으므로 객체를 통해 부른다.
    const scope = await sql.beginReadOnly(ctx)
    try {
      return { kind: 'rows', rows: await scope.execute(ctx, operation.sql, page, operation.params) }
    } finally {
      // end()를 빠뜨리면 읽기 전용 트랜잭션이 열린 채 남아 커넥션이 잠긴다.
      // 본문이 던져도 반드시 닫는다.
      await scope.end()
    }
  }
}
