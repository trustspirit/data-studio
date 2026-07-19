import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'

/**
 * `kind: 'schema'` 요청을 드라이버의 schema capability로 옮긴다.
 *
 * **이 실행기는 `driver.sql`을 절대 건드리지 않는다.** 정책은 schema 연산에
 * 읽기 전용 스코프를 요구하지 않으므로(메타데이터 조회는 데이터를 바꾸지
 * 않는다), schema 요청이 sql 실행 경로로 흘러갈 수 있다면 AI가 스코프 없이
 * 임의 SQL을 돌리는 통로가 된다. 그 경로를 문서로 금지하는 대신, 이 클래스가
 * sql capability를 참조조차 하지 않게 해서 구조적으로 불가능하게 만든다.
 */
export class SchemaCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'schema' as const

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx } = input

    if (operation.kind !== 'schema') {
      throw new Error(`SchemaCapabilityExecutor received ${operation.kind}`)
    }

    const schema = driver.schema
    if (schema === undefined) throw new Error('driver does not support schema introspection')

    switch (operation.op) {
      case 'listSchemas':
        return { kind: 'schemas', schemas: await schema.listSchemas(ctx) }
      case 'listTables':
        return { kind: 'tables', tables: await schema.listTables(ctx, operation.schema) }
      case 'describeTable':
        return {
          kind: 'tableDetail',
          detail: await schema.describeTable(ctx, operation.schema, operation.table),
        }
    }
  }
}
