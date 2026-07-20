import { describe, expect, it } from 'vitest'
import { createIpcConnectionGateway } from '@renderer/gateways/ipc/ipcConnectionGateway'
import { createIpcOperationGateway } from '@renderer/gateways/ipc/ipcOperationGateway'
import { IpcError, type DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'

function bridge(result: unknown) {
  const calls: { channel: string; input: unknown }[] = []
  const b: DataconBridge = {
    invoke: (channel, input) => {
      calls.push({ channel, input })
      return Promise.resolve(result)
    },
  }
  return { bridge: b, calls }
}

describe('ipcConnectionGateway', () => {
  it('list를 connection:list 채널로 부르고 값을 푼다', async () => {
    const configs = [{ id: 'c1' }]
    const { bridge: b, calls } = bridge({ ok: true, value: configs })
    const gateway = createIpcConnectionGateway(b)

    const result = await gateway.list()

    expect(calls[0]?.channel).toBe('connection:list')
    expect(result).toBe(configs)
  })

  it('save를 connection:save 채널로 설정과 함께 부른다', async () => {
    const { bridge: b, calls } = bridge({ ok: true, value: null })
    const gateway = createIpcConnectionGateway(b)
    const config = { id: 'c1', name: 'x' } as never

    await gateway.save(config)

    expect(calls[0]).toEqual({ channel: 'connection:save', input: config })
  })

  it('delete를 connection:delete 채널로 id와 함께 부른다', async () => {
    const { bridge: b, calls } = bridge({ ok: true, value: null })
    const gateway = createIpcConnectionGateway(b)

    await gateway.delete('c1')

    expect(calls[0]).toEqual({ channel: 'connection:delete', input: { id: 'c1' } })
  })

  it('IPC 실패를 IpcError로 바꾼다', async () => {
    const { bridge: b } = bridge({ ok: false, code: 'forbidden_sender' })
    const gateway = createIpcConnectionGateway(b)

    await expect(gateway.list()).rejects.toBeInstanceOf(IpcError)
  })

  it('IpcError는 코드와 채널을 담는다', async () => {
    const { bridge: b } = bridge({ ok: false, code: 'invalid_input' })
    const gateway = createIpcConnectionGateway(b)

    await expect(gateway.list()).rejects.toMatchObject({
      code: 'invalid_input',
      channel: 'connection:list',
    })
  })

  it('setSecret을 secrets:set 채널로 connectionId·value와 함께 부른다', async () => {
    const { bridge: b, calls } = bridge({ ok: true, value: null })
    const gateway = createIpcConnectionGateway(b)

    await gateway.setSecret('c1', 'pw')

    expect(calls[0]).toEqual({ channel: 'secrets:set', input: { connectionId: 'c1', value: 'pw' } })
  })

  it('hasSecret은 secrets:has의 exists를 boolean으로 푼다', async () => {
    const { bridge: b, calls } = bridge({ ok: true, value: { exists: true } })
    const gateway = createIpcConnectionGateway(b)

    const result = await gateway.hasSecret('c1')

    expect(calls[0]).toEqual({ channel: 'secrets:has', input: { connectionId: 'c1' } })
    expect(result).toBe(true)
  })

  it('secretsPersistent는 secrets:status의 persistent를 boolean으로 푼다', async () => {
    const { bridge: b, calls } = bridge({ ok: true, value: { persistent: false } })
    const gateway = createIpcConnectionGateway(b)

    const result = await gateway.secretsPersistent()

    expect(calls[0]?.channel).toBe('secrets:status')
    expect(result).toBe(false)
  })
})

describe('ipcOperationGateway', () => {
  it('run을 operation:run 채널로 요청과 함께 부른다', async () => {
    const outcome = { ok: true, payload: { kind: 'rows', rows: [] } }
    const { bridge: b, calls } = bridge({ ok: true, value: outcome })
    const gateway = createIpcOperationGateway(b)
    const request = {
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql' as const, sql: 'SELECT 1' },
    }

    const result = await gateway.run(request)

    expect(calls[0]).toEqual({ channel: 'operation:run', input: request })
    expect(result).toBe(outcome)
  })

  it('도메인 거부(OperationResult ok:false)는 오류가 아니라 값으로 돌려준다', async () => {
    // 전송은 성공했고 정책이 거부한 것이다. IpcError를 던지면 이 둘을 섞는다.
    const denied = { ok: false, reason: 'ai_write_requires_proposal' }
    const { bridge: b } = bridge({ ok: true, value: denied })
    const gateway = createIpcOperationGateway(b)

    const result = await gateway.run({
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'DELETE FROM t' },
    })

    expect(result).toEqual(denied)
  })

  it('cancel을 operation:cancel 채널로 부른다', async () => {
    const { bridge: b, calls } = bridge({ ok: true, value: null })
    const gateway = createIpcOperationGateway(b)

    await gateway.cancel('r1')

    expect(calls[0]).toEqual({ channel: 'operation:cancel', input: { requestId: 'r1' } })
  })

  it('recentAudit을 audit:recent 채널로 limit과 함께 부른다', async () => {
    const { bridge: b, calls } = bridge({ ok: true, value: [] })
    const gateway = createIpcOperationGateway(b)

    await gateway.recentAudit(20)

    expect(calls[0]).toEqual({ channel: 'audit:recent', input: { limit: 20 } })
  })

  it('전송 실패는 IpcError로 바꾼다', async () => {
    const { bridge: b } = bridge({ ok: false, code: 'internal_error' })
    const gateway = createIpcOperationGateway(b)

    await expect(gateway.cancel('r1')).rejects.toBeInstanceOf(IpcError)
  })
})
