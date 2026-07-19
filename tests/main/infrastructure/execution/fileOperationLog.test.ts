import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileOperationLog } from '@main/infrastructure/execution/FileOperationLog'
import type { OperationLogInput } from '@main/core/execution/OperationLog'

let dir = ''
let filePath = ''
const logger = { warn: vi.fn() }

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'datacon-audit-'))
  filePath = path.join(dir, 'audit.jsonl')
  logger.warn.mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function clock() {
  let now = 1_700_000_000_000
  return { now: () => (now += 1_000) }
}

function entry(over: Partial<OperationLogInput> = {}): OperationLogInput {
  return {
    requestId: 'r1',
    connectionId: 'c1',
    actorType: 'user',
    actorId: null,
    statement: 'SELECT 1',
    outcome: 'allowed',
    durationMs: 1,
    ...over,
  }
}

describe('FileOperationLog', () => {
  it('기록한 항목을 최신순으로 돌려준다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    log.record(entry({ requestId: 'r1' }))
    log.record(entry({ requestId: 'r2' }))

    expect(log.recent(10).map((e) => e.requestId)).toEqual(['r2', 'r1'])
  })

  it('재시작해도 파일에서 이력을 복원한다', async () => {
    const first = await FileOperationLog.create(filePath, clock(), logger)
    first.record(entry({ requestId: 'r1', statement: 'SELECT 1' }))
    first.record(entry({ requestId: 'r2', statement: 'SELECT 2' }))
    await first.flush()

    // 새 인스턴스 = 프로세스 재시작.
    const second = await FileOperationLog.create(filePath, clock(), logger)

    expect(second.recent(10).map((e) => e.requestId)).toEqual(['r2', 'r1'])
    expect(second.recent(1)[0]?.statement).toBe('SELECT 2')
  })

  it('append-only다 — 기록이 이전 줄을 덮어쓰지 않는다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    log.record(entry({ requestId: 'r1' }))
    log.record(entry({ requestId: 'r2' }))
    log.record(entry({ requestId: 'r3' }))
    await log.flush()

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(3)
  })

  it('JSONL 형식으로 쓴다 — 한 항목당 한 줄, 파싱 가능', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    log.record(entry({ requestId: 'r1', statement: "SELECT 'a;b'" }))
    await log.flush()

    const line = (await readFile(filePath, 'utf8')).trim()
    expect(line.split('\n')).toHaveLength(1)
    expect(JSON.parse(line)).toMatchObject({ requestId: 'r1', statement: "SELECT 'a;b'" })
  })

  it('손상된 줄은 건너뛰고 나머지를 살린다', async () => {
    const c = clock()
    const valid = JSON.stringify({ ...entry({ requestId: 'ok' }), at: 1 })
    // 유효한 줄 사이에 잘린(파싱 불가) 줄을 끼운다.
    await appendFile(filePath, `${valid}\n{"broken": \n${valid.replace('"ok"', '"ok2"')}\n`)

    const log = await FileOperationLog.create(filePath, c, logger)

    expect(log.recent(10).map((e) => e.requestId).sort()).toEqual(['ok', 'ok2'])
  })

  it('기록 순서가 파일에서도 유지된다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) log.record(entry({ requestId: id }))
    await log.flush()

    const ids = (await readFile(filePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { requestId: string }).requestId)
    expect(ids).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
  })

  it('빈 파일에서 깨끗하게 시작한다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)

    expect(log.recent(10)).toEqual([])
  })

  it('AI 문장을 원문 그대로 보관한다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    const statement = "SELECT * FROM t WHERE x = 'a;b' -- 주석"
    log.record(entry({ actorType: 'ai', actorId: 'sess-1', statement }))
    await log.flush()

    const restored = await FileOperationLog.create(filePath, clock(), logger)
    expect(restored.recent(1)[0]?.statement).toBe(statement)
  })

  it('limit이 0이나 음수면 빈 목록을 준다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    log.record(entry())

    expect(log.recent(0)).toEqual([])
    expect(log.recent(-5)).toEqual([])
  })

  it('기록 시각을 시계에서 붙인다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    log.record(entry())

    expect(log.recent(1)[0]?.at).toBe(1_700_000_001_000)
  })

  it('반환된 항목을 바꿔도 보관본이 오염되지 않는다', async () => {
    const log = await FileOperationLog.create(filePath, clock(), logger)
    log.record(entry({ statement: 'SELECT 1' }))

    const mutable = log.recent(1)[0] as { statement: string }
    mutable.statement = 'DROP TABLE users'

    expect(log.recent(1)[0]?.statement).toBe('SELECT 1')
  })

  it('기록 후 호출자가 입력 객체를 바꿔도 보관본이 바뀌지 않는다', async () => {
    // 입력을 그대로 담으면, 호출자가 재사용하는 객체 하나로 이미 기록된 감사
    // 항목이 소급해서 바뀐다.
    const log = await FileOperationLog.create(filePath, clock(), logger)
    const input: { -readonly [K in keyof OperationLogInput]: OperationLogInput[K] } = entry({
      requestId: 'r1',
      statement: 'SELECT 1',
    })
    log.record(input)

    input.statement = 'DROP TABLE users'
    input.requestId = 'r-forged'

    expect(log.recent(1)[0]).toMatchObject({ requestId: 'r1', statement: 'SELECT 1' })
  })

  it('쓰기 실패를 세고 로그에 남기되 실행을 막지 않는다', async () => {
    // 쓸 수 없는 경로. 감사 기록이 실패해도 record는 던지지 않아야 한다.
    const badPath = path.join(dir, 'no-such-dir', 'audit.jsonl')
    const log = await FileOperationLog.create(badPath, clock(), logger)

    expect(() => log.record(entry())).not.toThrow()
    await log.flush()

    // 메모리 미러에는 남고, 쓰기 실패는 카운트된다.
    expect(log.recent(1)).toHaveLength(1)
    expect(log.droppedCount()).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith('audit.write_failed', expect.anything())
  })
})
