import { describe, expect, it } from 'vitest'
import { IPC_CONTRACT, contractChannels } from '@shared/contracts/ipcContract'
import { ALL_CHANNELS } from '@shared/contracts/channels'

describe('IPC_CONTRACT', () => {
  it('모든 채널에 입력 스키마가 있다', () => {
    const channels = contractChannels()
    expect(channels.length).toBeGreaterThan(0)
    for (const channel of channels) {
      expect(IPC_CONTRACT[channel].input, `${channel}에 스키마가 없다`).toBeDefined()
    }
  })

  it('preload 화이트리스트는 계약에서 유도된다', () => {
    // 같은 출처(contractChannels)에서 나오므로 어긋날 수 없다. 무엇이 들었는지는
    // 아래 리터럴 테스트가 본다.
    expect([...ALL_CHANNELS].sort()).toEqual([...contractChannels()].sort())
  })

  it('기대한 채널 집합을 정확히 담는다', () => {
    // 리터럴로 못박는다. 위 유도 테스트는 두 목록이 같은 출처라 채널이 빠져도
    // 함께 빠지며 통과한다 — 실수로 채널을 지우거나 이름을 바꾼 것은 이 리터럴
    // 비교만이 잡는다.
    expect([...contractChannels()].sort()).toEqual(
      [
        'audit:recent',
        'connection:close',
        'connection:delete',
        'connection:list',
        'connection:open',
        'connection:save',
        'connection:status',
        'dialog:openFile',
        'operation:cancel',
        'operation:run',
        'secrets:has',
        'secrets:set',
        'secrets:status',
      ].sort(),
    )
  })

  it('operation 요청 스키마는 actor를 받아도 결과에 남기지 않는다', () => {
    const parsed = IPC_CONTRACT['operation:run'].input.safeParse({
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'SELECT 1' },
      actor: { type: 'user' },
      sessionId: 'sess-1',
    })

    // 위조한 actor/sessionId를 실어 보내도 파싱 결과에는 남지 않아야 한다.
    // renderer가 권한을 주장하는 통로를 열지 않는다.
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect('actor' in parsed.data).toBe(false)
      expect('sessionId' in parsed.data).toBe(false)
    }
  })

  it('operation 요청은 승인 토큰(proposalId)은 받아들인다', () => {
    const parsed = IPC_CONTRACT['operation:run'].input.safeParse({
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'SELECT 1' },
      proposalId: 'prop-1',
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.proposalId).toBe('prop-1')
  })

  it('connection:save는 커넥션 설정 스키마를 쓴다', () => {
    // 필수 필드가 빠진 설정은 거부되어야 한다.
    expect(IPC_CONTRACT['connection:save'].input.safeParse({ id: 'c1' }).success).toBe(false)
  })

  it('operation 스키마는 sql과 schema 종류만 받는다', () => {
    const schemaOp = IPC_CONTRACT['operation:run'].input.safeParse({
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'schema', op: 'listTables', schema: 'public' },
    })
    expect(schemaOp.success).toBe(true)

    const unknownKind = IPC_CONTRACT['operation:run'].input.safeParse({
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'document', collection: 'users' },
    })
    expect(unknownKind.success).toBe(false)
  })
})
