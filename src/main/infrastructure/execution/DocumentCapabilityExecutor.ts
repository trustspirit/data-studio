import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'
import type { DocumentFindReq } from '../../core/driver/capabilities/DocumentCapability'

/**
 * `kind: 'document'` 요청을 드라이버의 document capability로 옮긴다.
 *
 * find/aggregate/listCollections 모두 읽기(v1)라 결과는 `{ kind: 'rows' }`
 * 하나로 통일한다 — 한 행=문서 하나, `_doc` json 컬럼에 담기는 형태는
 * 드라이버가 이미 `ResultSet`으로 조립해 온다.
 */
export class DocumentCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'document' as const

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx, page } = input

    if (operation.kind !== 'document') {
      throw new Error(`DocumentCapabilityExecutor received ${operation.kind}`)
    }

    const doc = driver.document
    if (doc === undefined) throw new Error('driver does not support document capability')

    switch (operation.op) {
      case 'listCollections':
        return { kind: 'rows', rows: await doc.listCollections(ctx, page) }
      case 'find': {
        const req: DocumentFindReq = {
          collection: operation.collection,
          ...(operation.filter === undefined ? {} : { filter: operation.filter }),
          ...(operation.sort === undefined ? {} : { sort: operation.sort }),
          ...(operation.limit === undefined ? {} : { limit: operation.limit }),
        }
        return { kind: 'rows', rows: await doc.find(ctx, req, page) }
      }
      case 'aggregate':
        return {
          kind: 'rows',
          rows: await doc.aggregate(ctx, { collection: operation.collection, pipeline: operation.pipeline }, page),
        }
    }
  }
}
