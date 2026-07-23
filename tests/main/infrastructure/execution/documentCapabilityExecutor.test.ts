import { describe, expect, it } from 'vitest'
import { DocumentCapabilityExecutor } from '@main/infrastructure/execution/DocumentCapabilityExecutor'
import type { CapabilityExecuteInput } from '@main/core/execution/CapabilityExecutor'
import type { Driver } from '@main/core/driver/Driver'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'
import type { ExecutionLimits, Operation } from '@shared/types/operation'

const page: PageRequest = { cursor: null, maxRows: 10, maxBytes: 1000 }
const limits: ExecutionLimits = { timeoutMs: 1000, maxRows: 10, maxBytes: 1000 }

function resultFor(tag: string): ResultSet {
  return {
    requestId: 'r',
    columns: [{ name: '_doc', type: 'json' }],
    rows: [[{ t: 'str', v: tag }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 0 },
    meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}

function makeInput(
  operation: Operation,
  calls: { find: unknown[][]; aggregate: unknown[][]; listCollections: unknown[][] },
): CapabilityExecuteInput {
  const driver = {
    id: 'c',
    engine: 'mongodb',
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    ping: () => Promise.resolve(1),
    document: {
      listCollections: (_ctx: unknown, pg: PageRequest) => {
        calls.listCollections.push([pg])
        return Promise.resolve(resultFor('listCollections'))
      },
      find: (_ctx: unknown, req: unknown, pg: PageRequest) => {
        calls.find.push([req, pg])
        return Promise.resolve(resultFor('find'))
      },
      aggregate: (_ctx: unknown, req: unknown, pg: PageRequest) => {
        calls.aggregate.push([req, pg])
        return Promise.resolve(resultFor('aggregate'))
      },
      isReadOnlyPipeline: () => true,
    },
  } as unknown as Driver

  return {
    ctx: { requestId: 'r', signal: new AbortController().signal },
    driver,
    operation,
    page,
    limits,
    readOnlyScope: false,
  }
}

describe('DocumentCapabilityExecutor', () => {
  it('listCollections를 위임하고 rows 페이로드를 돌려준다', async () => {
    const calls = { find: [], aggregate: [], listCollections: [] } as {
      find: unknown[][]
      aggregate: unknown[][]
      listCollections: unknown[][]
    }
    const out = await new DocumentCapabilityExecutor().execute(
      makeInput({ kind: 'document', op: 'listCollections' }, calls),
    )

    expect(out.kind).toBe('rows')
    expect(calls.listCollections).toEqual([[page]])
  })

  it('find를 collection/filter/sort/limit과 함께 위임한다', async () => {
    const calls = { find: [], aggregate: [], listCollections: [] } as {
      find: unknown[][]
      aggregate: unknown[][]
      listCollections: unknown[][]
    }
    const out = await new DocumentCapabilityExecutor().execute(
      makeInput(
        { kind: 'document', op: 'find', collection: 'users', filter: '{"a":1}', sort: '{"a":-1}', limit: 5 },
        calls,
      ),
    )

    expect(out.kind).toBe('rows')
    expect(calls.find[0]?.[0]).toEqual({
      collection: 'users',
      filter: '{"a":1}',
      sort: '{"a":-1}',
      limit: 5,
    })
  })

  it('선택 필드가 없는 find는 undefined 키 없이 위임한다', async () => {
    const calls = { find: [], aggregate: [], listCollections: [] } as {
      find: unknown[][]
      aggregate: unknown[][]
      listCollections: unknown[][]
    }
    await new DocumentCapabilityExecutor().execute(
      makeInput({ kind: 'document', op: 'find', collection: 'users' }, calls),
    )

    expect(calls.find[0]?.[0]).toEqual({ collection: 'users' })
  })

  it('aggregate를 collection/pipeline과 함께 위임한다', async () => {
    const calls = { find: [], aggregate: [], listCollections: [] } as {
      find: unknown[][]
      aggregate: unknown[][]
      listCollections: unknown[][]
    }
    const out = await new DocumentCapabilityExecutor().execute(
      makeInput({ kind: 'document', op: 'aggregate', collection: 'orders', pipeline: '[{"$match":{}}]' }, calls),
    )

    expect(out.kind).toBe('rows')
    expect(calls.aggregate[0]?.[0]).toEqual({ collection: 'orders', pipeline: '[{"$match":{}}]' })
  })

  it('isReadOnlyPipeline이 false면 aggregate를 드라이버로 위임하지 않고 던진다($out)', async () => {
    const calls = { find: [], aggregate: [], listCollections: [] } as {
      find: unknown[][]
      aggregate: unknown[][]
      listCollections: unknown[][]
    }
    const input = makeInput(
      { kind: 'document', op: 'aggregate', collection: 'orders', pipeline: '[{"$out":"copy"}]' },
      calls,
    )
    // isReadOnlyPipeline을 false로 덮어써 $out 파이프라인을 흉내낸다.
    ;(input.driver.document as { isReadOnlyPipeline: (pipeline: string) => boolean }).isReadOnlyPipeline = () => false

    await expect(new DocumentCapabilityExecutor().execute(input)).rejects.toThrow(
      /read-only/,
    )
    expect(calls.aggregate).toEqual([])
  })

  it('isReadOnlyPipeline이 false면 aggregate를 드라이버로 위임하지 않고 던진다($merge)', async () => {
    const calls = { find: [], aggregate: [], listCollections: [] } as {
      find: unknown[][]
      aggregate: unknown[][]
      listCollections: unknown[][]
    }
    const input = makeInput(
      { kind: 'document', op: 'aggregate', collection: 'orders', pipeline: '[{"$merge":{"into":"copy"}}]' },
      calls,
    )
    ;(input.driver.document as { isReadOnlyPipeline: (pipeline: string) => boolean }).isReadOnlyPipeline = () => false

    await expect(new DocumentCapabilityExecutor().execute(input)).rejects.toThrow(
      /read-only/,
    )
    expect(calls.aggregate).toEqual([])
  })

  it('isReadOnlyPipeline이 true인 정상 파이프라인은 그대로 통과한다', async () => {
    const calls = { find: [], aggregate: [], listCollections: [] } as {
      find: unknown[][]
      aggregate: unknown[][]
      listCollections: unknown[][]
    }
    const out = await new DocumentCapabilityExecutor().execute(
      makeInput(
        { kind: 'document', op: 'aggregate', collection: 'orders', pipeline: '[{"$match":{}}]' },
        calls,
      ),
    )
    expect(out.kind).toBe('rows')
    expect(calls.aggregate).toHaveLength(1)
  })

  it('document capability가 없으면 던진다', async () => {
    const driver = {
      id: 'c', engine: 'mongodb',
      connect: () => Promise.resolve(), disconnect: () => Promise.resolve(), ping: () => Promise.resolve(1),
    } as unknown as Driver

    await expect(
      new DocumentCapabilityExecutor().execute({
        ctx: { requestId: 'r', signal: new AbortController().signal },
        driver,
        operation: { kind: 'document', op: 'listCollections' },
        page,
        limits,
        readOnlyScope: false,
      }),
    ).rejects.toThrow()
  })
})
