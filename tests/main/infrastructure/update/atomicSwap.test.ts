import { describe, expect, it } from 'vitest'
import { swapApp, type SwapFs } from '@main/infrastructure/update/atomicSwap'

const APP = '/Applications/App.app'
const STAGED = '/tmp/staged/App.app'
const BACKUP = '/Applications/App.app.backup'

/**
 * 가짜 파일시스템. 존재하는 경로 집합으로 상태를 흉내 낸다. 특정 연산을
 * 실패시키거나 healthCheck 결과를 정할 수 있다.
 */
function fakeFs(options: {
  // 이 소스에서 나가는 move를 실패시킨다. dest가 아니라 src를 기준으로 해야
  // 복원(backup→app)까지 함께 막지 않는다 — 현실에서 staged→app 실패와
  // backup→app 복원은 서로 독립이다.
  failMoveFrom?: string
  health?: boolean
} = {}) {
  // 시작 상태: 제자리 앱과 스테이징된 앱이 존재한다.
  const paths = new Set<string>([APP, STAGED])

  const fs: SwapFs = {
    move: (src, dest) => {
      if (options.failMoveFrom === src) return Promise.reject(new Error(`move from ${src} failed`))
      if (!paths.has(src)) return Promise.reject(new Error(`no such path: ${src}`))
      paths.delete(src)
      paths.add(dest)
      return Promise.resolve()
    },
    remove: (path) => {
      paths.delete(path)
      return Promise.resolve()
    },
    healthCheck: () => Promise.resolve(options.health ?? true),
  }

  return { fs, has: (p: string) => paths.has(p) }
}

describe('swapApp', () => {
  it('정상 경로: 교체하고 백업을 지운다', async () => {
    const f = fakeFs()
    const result = await swapApp({ fs: f.fs, appPath: APP, stagedPath: STAGED, backupPath: BACKUP })

    expect(result).toEqual({ ok: true })
    expect(f.has(APP)).toBe(true)
    expect(f.has(BACKUP)).toBe(false)
  })

  it('새 앱 이동이 실패하면 백업을 복원한다', async () => {
    // 백업으로는 옮겨졌지만 새 앱을 제자리로 옮기다 실패.
    const f = fakeFs({ failMoveFrom: STAGED })
    const result = await swapApp({ fs: f.fs, appPath: APP, stagedPath: STAGED, backupPath: BACKUP })

    expect(result).toEqual({ ok: false, reason: 'swap_failed', rolledBack: true })
    // 핵심 불변식: 실패했어도 제자리에 앱이 있다.
    expect(f.has(APP)).toBe(true)
  })

  it('헬스체크가 실패하면 새 앱을 치우고 백업을 복원한다', async () => {
    const f = fakeFs({ health: false })
    const result = await swapApp({ fs: f.fs, appPath: APP, stagedPath: STAGED, backupPath: BACKUP })

    expect(result).toEqual({ ok: false, reason: 'health_failed', rolledBack: true })
    expect(f.has(APP)).toBe(true)
  })

  it('어떤 실패 경로에서도 제자리에 앱이 남는다', async () => {
    for (const opts of [{ failMoveFrom: STAGED }, { health: false }]) {
      const f = fakeFs(opts)
      await swapApp({ fs: f.fs, appPath: APP, stagedPath: STAGED, backupPath: BACKUP })
      expect(f.has(APP), `실패 옵션 ${JSON.stringify(opts)}에서 앱이 사라졌다`).toBe(true)
    }
  })

  it('첫 백업 이동이 실패하면 아무것도 건드리지 않는다', async () => {
    const f = fakeFs({ failMoveFrom: APP })
    const result = await swapApp({ fs: f.fs, appPath: APP, stagedPath: STAGED, backupPath: BACKUP })

    expect(result).toEqual({ ok: false, reason: 'swap_failed', rolledBack: true })
    expect(f.has(APP)).toBe(true)
    expect(f.has(STAGED)).toBe(true)
  })

  it('성공 시 스테이징 경로의 앱이 제자리로 옮겨진다', async () => {
    const f = fakeFs()
    await swapApp({ fs: f.fs, appPath: APP, stagedPath: STAGED, backupPath: BACKUP })

    expect(f.has(STAGED)).toBe(false)
    expect(f.has(APP)).toBe(true)
  })
})
