import { describe, expect, it, vi } from 'vitest'
import { buildAppServices, type AppDeps } from '@main/app/compositionRoot'
import type { OperationLog, OperationLogEntry } from '@main/core/execution/OperationLog'
import type { ConnectionRepository } from '@main/core/ports/ConnectionRepository'
import type { SecretStore } from '@main/core/ports/SecretStore'
import type { FileDialogPort } from '@main/core/ports/FileDialog'

function recordingLog() {
  const entries: OperationLogEntry[] = []
  const log: OperationLog = {
    record: (input) => entries.push({ ...input, at: 0 }),
    recent: (limit) => entries.slice(-limit).reverse(),
    droppedCount: () => 0,
  }
  return { log, entries }
}

const repository: ConnectionRepository = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  save: () => Promise.resolve(),
  delete: () => Promise.resolve(),
}

const secrets: SecretStore = {
  isPersistent: () => true,
  set: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
}

const fileDialog: FileDialogPort = {
  openFile: () => Promise.resolve(null),
}

function deps(over: Partial<AppDeps> = {}): AppDeps {
  const { log } = recordingLog()
  return {
    logger: { warn: vi.fn() },
    repository,
    secrets,
    log,
    fileDialog,
    clock: {
      now: () => 1_000,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    randomId: () => 'prop-1',
    hash: (text) => `hash(${text})`,
    pool: { maxConcurrent: 4, queueTimeoutMs: 30_000 },
    ...over,
  }
}

describe('buildAppServices', () => {
  it('electron 없이 완전한 서비스 묶음을 만든다', () => {
    const services = buildAppServices(deps())

    expect(services.executor).toBeDefined()
    expect(services.connections).toBeDefined()
    expect(services.registry).toBeDefined()
    expect(services.proposals).toBeDefined()
  })

  it('드라이버를 등록하지 않으면 레지스트리가 비어 있다', () => {
    const services = buildAppServices(deps())

    expect(services.registry.registeredEngines()).toEqual([])
  })

  it('registerDrivers 훅으로 드라이버를 등록한다', () => {
    const services = buildAppServices(
      deps({
        registerDrivers: (registry) => {
          registry.register('postgres', (config) => ({
            id: config.id,
            engine: config.engine,
            connect: () => Promise.resolve(),
            disconnect: () => Promise.resolve(),
            ping: () => Promise.resolve(1),
          }))
        },
      }),
    )

    expect(services.registry.registeredEngines()).toEqual(['postgres'])
  })

  it('executor가 주입된 log를 실제로 쓴다', async () => {
    // executor가 자기 상태를 보고하는 게 아니라 주입된 협력자의 호출로 확인한다.
    const { log, entries } = recordingLog()
    const services = buildAppServices(deps({ log }))

    // 등록된 드라이버가 없으므로 open은 실패하지만, 그 시도 자체가 감사되는지가
    // 아니라 — executor가 이 log 인스턴스를 들고 있는지를 본다. 커넥션을 얻지
    // 못하는 요청도 감사 항목을 남긴다.
    await services.executor.run(
      { requestId: 'r1', connectionId: 'c1', operation: { kind: 'sql', sql: 'SELECT 1' } },
      { type: 'user', grant: null },
    )

    expect(entries.length).toBeGreaterThan(0)
  })

  it('sweepProposals가 proposals의 sweep을 부른다', () => {
    const services = buildAppServices(deps())
    const spy = vi.spyOn(services.proposals, 'sweep')

    services.sweepProposals()

    expect(spy).toHaveBeenCalledOnce()
  })

  it('proposals가 주입된 시계·난수·해시를 쓴다', () => {
    const services = buildAppServices(deps())

    const view = services.proposals.propose({
      connectionId: 'c1',
      statement: 'DELETE FROM users',
      impact: { summary: '', estimatedRows: null },
    })

    expect(view.proposalId).toBe('prop-1')
    expect(view.statementHash).toBe('hash(DELETE FROM users)')
  })
})
