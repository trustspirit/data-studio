import type { PageRequest, ResultSet } from '@shared/types/resultSet'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { KeyValueCapability, KeyScanReq } from '@main/core/driver/capabilities/KeyValueCapability'
import type { RedisClientLike } from './RedisDriver'

/** Task 4에서 scan/get을 구현한다. 지금은 골격만. */
export class RedisKeyValueCapability implements KeyValueCapability {
  constructor(private readonly getClient: () => RedisClientLike) {}

  scan(_ctx: ExecutionContext, _req: KeyScanReq, _page: PageRequest): Promise<ResultSet> {
    void this.getClient
    return Promise.reject(new Error('not implemented'))
  }

  get(_ctx: ExecutionContext, _key: string, _page: PageRequest): Promise<ResultSet> {
    return Promise.reject(new Error('not implemented'))
  }
}
