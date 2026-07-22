import { describe, it, expect } from 'vitest'
import { cancelQuery } from '@main/drivers/mysql/mysqlCancel'
import type { MysqlClientLike } from '@main/drivers/mysql/MysqlDriver'

describe('cancelQuery', () => {
  it('side 커넥션으로 KILL QUERY <threadId>를 실행하고 닫는다', async () => {
    const queries: string[] = []
    let ended = false
    const fake: MysqlClientLike = {
      query: (sql) => {
        queries.push(typeof sql === 'string' ? sql : sql.sql)
        return Promise.resolve([[], []])
      },
      end: () => {
        ended = true
        return Promise.resolve()
      },
      threadId: 999,
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    }
    await cancelQuery(() => Promise.resolve(fake), 42)
    expect(queries).toEqual(['KILL QUERY 42'])
    expect(ended).toBe(true)
  })

  it('정수가 아닌 threadId는 삽입하지 않는다(방어)', async () => {
    const fake: MysqlClientLike = {
      query: () => Promise.resolve([[], []]),
      end: () => Promise.resolve(),
      threadId: 1,
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    }
    // @ts-expect-error 방어 테스트
    await expect(cancelQuery(() => Promise.resolve(fake), '1; DROP')).rejects.toThrow()
  })

  it('side 커넥션 실패는 삼킨다(best-effort)', async () => {
    await expect(
      cancelQuery(() => Promise.reject(new Error('conn refused')), 42),
    ).resolves.toBeUndefined()
  })
})
