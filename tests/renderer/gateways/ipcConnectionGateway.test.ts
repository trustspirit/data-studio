import { describe, it, expect } from 'vitest'
import { createIpcConnectionGateway } from '@renderer/gateways/ipc/ipcConnectionGateway'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'

describe('ipcConnectionGateway openFileDialog', () => {
  it('openFileDialog는 dialog:openFile을 호출하고 경로를 반환', async () => {
    const calls: Array<{ channel: string; payload: unknown }> = []
    const bridge: DataconBridge = {
      invoke: (channel, payload) => {
        calls.push({ channel, payload })
        return Promise.resolve({ ok: true, value: '/tmp/x.db' })
      },
    }
    const gw = createIpcConnectionGateway(bridge)
    expect(await gw.openFileDialog()).toBe('/tmp/x.db')
    expect(calls[0]?.channel).toBe('dialog:openFile')
  })

  it('openFileDialog는 취소 시 null을 반환', async () => {
    const bridge: DataconBridge = {
      invoke: () => Promise.resolve({ ok: true, value: null }),
    }
    const gw = createIpcConnectionGateway(bridge)
    expect(await gw.openFileDialog()).toBeNull()
  })
})
