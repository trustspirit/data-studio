import { describe, it, expect, vi } from 'vitest'
import { maybeRunSqliteSmoke, SMOKE_FLAG, SMOKE_SENTINEL } from '@main/smoke'

describe('maybeRunSqliteSmoke', () => {
  it('플래그가 없으면 false를 반환하고 아무 출력·종료도 하지 않는다', () => {
    const exit = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const ran = maybeRunSqliteSmoke(['node', 'app'], exit as unknown as (code: number) => never)
      expect(ran).toBe(false)
      expect(exit).not.toHaveBeenCalled()
      expect(log).not.toHaveBeenCalledWith(SMOKE_SENTINEL)
    } finally {
      log.mockRestore()
    }
  })

  it('플래그가 있으면 :memory: SQLite로 SELECT 1을 성공시키고 센티넬 출력 후 exit(0)', () => {
    const exit = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const ran = maybeRunSqliteSmoke(['node', 'app', SMOKE_FLAG], exit as unknown as (code: number) => never)
      expect(ran).toBe(true)
      expect(log).toHaveBeenCalledWith(SMOKE_SENTINEL)
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      log.mockRestore()
    }
  })
})
