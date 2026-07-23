import { describe, it, expect } from 'vitest'
import { KeyValueCapabilityExecutor } from '@main/infrastructure/execution/KeyValueCapabilityExecutor'
import type { CapabilityExecuteInput } from '@main/core/execution/CapabilityExecutor'
import type { Driver } from '@main/core/driver/Driver'
import type { KeyValueCapability, KeyScanReq } from '@main/core/driver/capabilities/KeyValueCapability'
import type { ResultSet } from '@shared/types/resultSet'
import type { Operation } from '@shared/types/operation'

const fakeRs = (id: string): ResultSet => ({
  requestId: id, columns: [], rows: [],
  page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
  meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
})

function driverWith(kv: KeyValueCapability): Driver {
  return { id: 'c', engine: 'redis', connect: () => Promise.resolve(), disconnect: () => Promise.resolve(), ping: () => Promise.resolve(0), keyValue: kv }
}

const ctx = { requestId: 'r1', signal: new AbortController().signal }
const page = { cursor: null, maxRows: 100, maxBytes: 1000 }

function inputFor(driver: Driver, operation: Operation): CapabilityExecuteInput {
  return { ctx, driver, operation, page, limits: { timeoutMs: 1000, maxRows: 100, maxBytes: 1000 }, readOnlyScope: false }
}

describe('KeyValueCapabilityExecutor', () => {
  it('scan을 driver.keyValue.scan으로 위임하고 rows payload를 준다', async () => {
    let seen: KeyScanReq | null = null
    const kv: KeyValueCapability = {
      scan: (_c, req) => { seen = req; return Promise.resolve(fakeRs('scan')) },
      get: () => Promise.resolve(fakeRs('get')),
    }
    const out = await new KeyValueCapabilityExecutor().execute(
      inputFor(driverWith(kv), { kind: 'keyvalue', op: 'scan', match: 'user:*' }),
    )
    expect(out).toEqual({ kind: 'rows', rows: fakeRs('scan') })
    expect(seen).toEqual({ match: 'user:*' })
  })

  it('match 없으면 빈 req로 위임한다', async () => {
    let seen: KeyScanReq | null = null
    const kv: KeyValueCapability = {
      scan: (_c, req) => { seen = req; return Promise.resolve(fakeRs('scan')) },
      get: () => Promise.resolve(fakeRs('get')),
    }
    await new KeyValueCapabilityExecutor().execute(inputFor(driverWith(kv), { kind: 'keyvalue', op: 'scan' }))
    expect(seen).toEqual({})
  })

  it('get을 key와 함께 위임한다', async () => {
    let seenKey = ''
    const kv: KeyValueCapability = {
      scan: () => Promise.resolve(fakeRs('scan')),
      get: (_c, key) => { seenKey = key; return Promise.resolve(fakeRs('get')) },
    }
    const out = await new KeyValueCapabilityExecutor().execute(
      inputFor(driverWith(kv), { kind: 'keyvalue', op: 'get', key: 'k1' }),
    )
    expect(out).toEqual({ kind: 'rows', rows: fakeRs('get') })
    expect(seenKey).toBe('k1')
  })
})
