import { describe, expect, it } from 'vitest'
import { OperationExecutor } from '@main/core/execution/OperationExecutor'
import { WriteProposalStore } from '@main/core/execution/WriteProposalStore'
import { SchemaCapabilityExecutor } from '@main/infrastructure/execution/SchemaCapabilityExecutor'
import { InMemoryOperationLog } from '@main/infrastructure/execution/InMemoryOperationLog'
import type {
  ConnectionManager,
  ConnectionStatus,
  LeasedConnection,
} from '@main/core/connection/ConnectionManager'
import type { Driver } from '@main/core/driver/Driver'
import type { Actor } from '@main/core/execution/Actor'
import type { OperationRequest } from '@shared/types/operation'

/**
 * AI actor의 풀 라우팅(poolIdFor): AI 읽기 전용 파생 커넥션(`{id}::ai`)이
 * 열려 있으면 그쪽 lease를, 없으면 사용자 커넥션 lease를 쓴다.
 */

function fakeDriver(): Driver {
  return {
    id: 'conn',
    engine: 'postgres',
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    ping: () => Promise.resolve(1),
    schema: {
      listSchemas: () => Promise.resolve([{ name: 'public' }]),
      listTables: () => Promise.resolve([]),
      describeTable: () => Promise.reject(new Error('unused')),
      listIndexes: () => Promise.resolve([]),
      listForeignKeys: () => Promise.resolve([]),
    },
  }
}

function createHarness(statusOf: (id: string) => ConnectionStatus) {
  const acquired: string[] = []
  const lease = (): LeasedConnection => ({
    driver: fakeDriver(),
    signal: new AbortController().signal,
    release: () => {},
  })
  const connections: ConnectionManager = {
    acquire: (id) => {
      acquired.push(id)
      return Promise.resolve(lease())
    },
    open: () => Promise.resolve(),
    capabilities: () => [],
    close: () => Promise.resolve(),
    closeAll: () => Promise.resolve(),
    status: statusOf,
    checkHealth: () => Promise.resolve(true),
  }
  const executor = new OperationExecutor(
    connections,
    new InMemoryOperationLog({ now: () => 1 }),
    [new SchemaCapabilityExecutor()],
    { now: () => 1, setTimeout: () => 0, clearTimeout: () => {} },
    new WriteProposalStore({ now: () => 1, randomId: () => 'p', hash: (t) => t }),
  )
  return { executor, acquired }
}

const REQUEST: OperationRequest = {
  requestId: 'r1',
  connectionId: 'c1',
  operation: { kind: 'schema', op: 'listSchemas' },
}
const AI: Actor = { type: 'ai', sessionId: 's1' }
const USER: Actor = { type: 'user', grant: null }

describe('OperationExecutor AI 커넥션 라우팅', () => {
  it('AI actor는 파생 커넥션(::ai)이 ready면 그쪽을 임차한다', async () => {
    const h = createHarness((id) => (id === 'c1::ai' ? 'ready' : 'ready'))
    const result = await h.executor.run(REQUEST, AI)
    expect(result.ok).toBe(true)
    expect(h.acquired).toEqual(['c1::ai'])
  })

  it('파생 커넥션이 없으면 사용자 커넥션으로 내려간다', async () => {
    const h = createHarness((id) => (id === 'c1::ai' ? 'closed' : 'ready'))
    const result = await h.executor.run(REQUEST, AI)
    expect(result.ok).toBe(true)
    expect(h.acquired).toEqual(['c1'])
  })

  it('사용자 actor는 파생 커넥션 상태와 무관하게 원 커넥션을 임차한다', async () => {
    const h = createHarness(() => 'ready')
    const result = await h.executor.run(REQUEST, USER)
    expect(result.ok).toBe(true)
    expect(h.acquired).toEqual(['c1'])
  })
})
