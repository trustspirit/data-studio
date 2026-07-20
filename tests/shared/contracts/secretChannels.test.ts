import { describe, expect, it } from 'vitest'
import { contractChannels } from '@shared/contracts/ipcContract'

describe('secret IPC 채널 불변식', () => {
  it('비밀 채널 집합은 정확히 set/has/status — 값 read 채널 없음', () => {
    // 비밀 값을 renderer로 돌려주는 read 채널(secrets:get 등)이 몰래 추가되면
    // write-only 불변식이 깨진다. 집합을 정확히 고정해 그런 채널 추가가
    // 이 테스트를 깨도록 한다.
    const secretChannels = contractChannels()
      .filter((c) => c.startsWith('secrets:'))
      .sort()
    expect(secretChannels).toEqual(['secrets:has', 'secrets:set', 'secrets:status'])
  })
})
