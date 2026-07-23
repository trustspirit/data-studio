import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'
import type { KeyScanReq } from '../../core/driver/capabilities/KeyValueCapability'

/**
 * `kind: 'keyvalue'` 요청을 드라이버의 keyValue capability로 옮긴다.
 *
 * scan/get 모두 읽기(v1)라 결과는 `{ kind: 'rows' }` 하나로 통일한다 —
 * scan은 `[key, type, ttl]`, get은 `[type, ttl, value]` 형태로 드라이버가
 * 이미 `ResultSet`을 조립해 온다.
 *
 * DocumentCapabilityExecutor의 aggregate 같은 방어 게이트가 없다 —
 * scan/get은 쓰기 벡터가 없다.
 */
export class KeyValueCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'keyvalue' as const

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx, page } = input

    if (operation.kind !== 'keyvalue') {
      throw new Error(`KeyValueCapabilityExecutor received ${operation.kind}`)
    }

    const kv = driver.keyValue
    if (kv === undefined) throw new Error('driver does not support keyvalue capability')

    switch (operation.op) {
      case 'scan': {
        const req: KeyScanReq = operation.match === undefined ? {} : { match: operation.match }
        return { kind: 'rows', rows: await kv.scan(ctx, req, page) }
      }
      case 'get':
        return { kind: 'rows', rows: await kv.get(ctx, operation.key, page) }
    }
  }
}
