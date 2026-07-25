import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'

/**
 * `kind: 'dynamo'` 요청을 드라이버의 dynamo capability로 옮긴다.
 *
 * listTables/scan/partiql 모두 읽기(v1)라 결과는 `{ kind: 'rows' }`로 통일한다 —
 * 한 행=아이템 하나, `_item` json 컬럼은 드라이버가 이미 ResultSet으로 조립해 온다.
 *
 * partiql은 드라이버로 넘기기 전에 여기서 읽기 전용을 강제한다. dynamo 연산은
 * 정책상 항상 read로 분류되므로(PartiQL의 INSERT/UPDATE/DELETE를 걸러내는 유일한
 * 관문이 이것이다), DocumentCapabilityExecutor의 aggregate 게이트와 같은 이유로
 * 이 검사가 없으면 어떤 dynamo 드라이버든 비-SELECT PartiQL로 v1 읽기 전용
 * 정책을 우회할 수 있다. 드라이버도 방어적으로 같은 검사를 한다(defense in depth).
 */
export class DynamoCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'dynamo' as const

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx, page } = input

    if (operation.kind !== 'dynamo') {
      throw new Error(`DynamoCapabilityExecutor received ${operation.kind}`)
    }

    const dynamo = driver.dynamo
    if (dynamo === undefined) throw new Error('driver does not support dynamo capability')

    switch (operation.op) {
      case 'listTables':
        return { kind: 'rows', rows: await dynamo.listTables(ctx, page) }
      case 'scan':
        return { kind: 'rows', rows: await dynamo.scan(ctx, { table: operation.table }, page) }
      case 'partiql': {
        if (!dynamo.isReadOnlyStatement(operation.statement)) {
          throw new Error('PartiQL statement is not read-only (only SELECT allowed in v1)')
        }
        return { kind: 'rows', rows: await dynamo.partiql(ctx, { statement: operation.statement }, page) }
      }
    }
  }
}
