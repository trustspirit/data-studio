// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildGateways } from '@renderer/app/container'
import { GatewayProvider, useGateways } from '@renderer/app/GatewayProvider'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'

const fakeBridge: DataconBridge = { invoke: vi.fn().mockResolvedValue({ ok: true, value: [] }) }

describe('buildGateways', () => {
  it('bridge로 connection 게이트웨이를 만든다', () => {
    const gateways = buildGateways(fakeBridge)
    expect(typeof gateways.connection.list).toBe('function')
  })
})

describe('useGateways', () => {
  it('Provider 안에서 주입된 게이트웨이를 준다', () => {
    const gateways = buildGateways(fakeBridge)
    const { result } = renderHook(() => useGateways(), {
      wrapper: ({ children }) => <GatewayProvider gateways={gateways}>{children}</GatewayProvider>,
    })
    expect(result.current).toBe(gateways)
  })

  it('Provider 밖에서 부르면 throw한다', () => {
    // 이 가드가 없으면 null.connection 접근이 런타임에 애매하게 터진다.
    expect(() => renderHook(() => useGateways())).toThrow(/GatewayProvider/)
  })
})
