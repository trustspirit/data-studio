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
      case 'aggregate': {
        // 관문(engine-agnostic): document 연산은 정책상 항상 read로 분류되므로
        // ($out/$merge 같은 쓰기 스테이지를 걸러내는 유일한 방어가 이것이다),
        // 드라이버로 넘기기 전에 여기서 반드시 거부해야 한다. 드라이버의
        // aggregate도 방어적으로 같은 검사를 하지만(defense in depth), 이
        // 관문이 없으면 어떤 document 드라이버든 $out/$merge로 v1의 읽기
        // 전용 정책을 우회할 수 있다.
        if (!doc.isReadOnlyPipeline(operation.pipeline)) {
          throw new Error('aggregate pipeline is not read-only ($out/$merge not allowed in v1)')
        }
        return {
          kind: 'rows',
          rows: await doc.aggregate(ctx, { collection: operation.collection, pipeline: operation.pipeline }, page),
        }
      }
    }
  }
}
