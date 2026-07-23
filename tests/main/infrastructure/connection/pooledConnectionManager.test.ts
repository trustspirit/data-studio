import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriverRegistry } from '@main/core/driver/DriverRegistry'
import {
  AcquireTimeoutError,
  ConnectionConfigChangedError,
  ConnectionNotOpenError,
  PooledConnectionManager,
} from '@main/infrastructure/connection/PooledConnectionManager'
import { createMemoryDriver } from '@main/drivers/memory/MemoryDriver'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'

const CONFIG: ConnectionConfig = {
  id: 'conn-1',
  name: 'Memory',
  engine: 'sqlite',
  host: '',
  port: 0,
  database: ':memory:',
  username: '',
  tlsMode: 'disable',
  aiReadOnlyUsername: null,
  maskedColumnPatterns: [],
}

/** 제어 가능한 드라이버를 쓰는 설정. 엔진만 다르고 나머지는 CONFIG와 같다. */
const FAKE_CONFIG: ConnectionConfig = { ...CONFIG, id: 'fake-1', engine: 'postgres' }

const logger = { warn: vi.fn() }

/**
 * connect/disconnect/ping의 결과를 테스트가 직접 정하는 드라이버.
 *
 * MemoryDriver는 셋 다 무조건 성공하므로 실패 경로를 표현할 수 없다.
 * 호출 횟수는 이 double이 세므로, 구현이 무엇을 했는지가 아니라
 * **드라이버가 실제로 무엇을 받았는지**로 단언한다.
 */
interface FakeDriver extends Driver {
  readonly calls: { connect: number; disconnect: number; ping: number }
}

interface FakeBehavior {
  /**
   * n번째(1-based) connect 시도가 실패해야 하면 그 번호들. 시도 번호는
   * 드라이버 인스턴스가 아니라 harness 전체에서 센다 — 재시도는 새 드라이버로
   * 일어나므로, 인스턴스별로 세면 "첫 시도만 실패"를 표현할 수 없다.
   */
  readonly failConnectOn?: readonly number[]
  /** connect를 이 promise가 풀릴 때까지 붙잡는다. */
  readonly gate?: Promise<void>
  readonly failPing?: boolean
  /** disconnect가 거부하게 만든다. 정리 실패가 원래 원인을 가리는지 보기 위한 것. */
  readonly failDisconnect?: boolean
}

function createFakeDriver(
  config: ConnectionConfig,
  behavior: FakeBehavior,
  attempts: { count: number },
): FakeDriver {
  const calls = { connect: 0, disconnect: 0, ping: 0 }

  return {
    id: config.id,
    engine: config.engine,
    calls,
    async connect(): Promise<void> {
      calls.connect += 1
      attempts.count += 1
      const attempt = attempts.count
      if (behavior.gate !== undefined) await behavior.gate
      if (behavior.failConnectOn?.includes(attempt) === true) {
        throw new Error(`connect failed on attempt ${attempt}`)
      }
    },
    disconnect(): Promise<void> {
      calls.disconnect += 1
      return behavior.failDisconnect === true
        ? Promise.reject(new Error('disconnect failed'))
        : Promise.resolve()
    },
    ping(): Promise<number> {
      calls.ping += 1
      return behavior.failPing === true
        ? Promise.reject(new Error('ping failed'))
        : Promise.resolve(1)
    },
  }
}

interface Harness {
  readonly manager: PooledConnectionManager
  /** registry.create가 실제로 만들어 낸 드라이버들, 만들어진 순서대로. */
  readonly created: Driver[]
  readonly fakes: FakeDriver[]
}

function createHarness(
  maxConcurrent: number,
  queueTimeoutMs = 1000,
  behavior: FakeBehavior = {},
): Harness {
  const registry = new DriverRegistry()
  const created: Driver[] = []
  const fakes: FakeDriver[] = []
  const attempts = { count: 0 }

  registry.register('sqlite', (config) => {
    const driver = createMemoryDriver(config)
    created.push(driver)
    return driver
  })
  registry.register('postgres', (config) => {
    const driver = createFakeDriver(config, behavior, attempts)
    created.push(driver)
    fakes.push(driver)
    return driver
  })

  const manager = new PooledConnectionManager(registry, logger, { maxConcurrent, queueTimeoutMs })
  return { manager, created, fakes }
}

function createManager(maxConcurrent: number, queueTimeoutMs = 1000): PooledConnectionManager {
  return createHarness(maxConcurrent, queueTimeoutMs).manager
}

beforeEach(() => {
  logger.warn.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PooledConnectionManager', () => {
  it('열기 전에는 closed다', () => {
    const manager = createManager(2)

    expect(manager.status('conn-1')).toBe('closed')
  })

  it('열면 ready가 된다', async () => {
    const manager = createManager(2)
    await manager.open(CONFIG)

    expect(manager.status('conn-1')).toBe('ready')
  })

  it('열지 않은 커넥션 임차는 거부한다', async () => {
    const manager = createManager(2)

    await expect(manager.acquire('conn-1')).rejects.toThrow(ConnectionNotOpenError)
  })

  it('임차하면 드라이버를 준다', async () => {
    const manager = createManager(2)
    await manager.open(CONFIG)

    const lease = await manager.acquire('conn-1')

    expect(lease.driver.id).toBe('conn-1')
    lease.release()
  })

  describe('capabilities', () => {
    it('열려 있지 않으면 ConnectionNotOpenError를 던진다', () => {
      const manager = createManager(2)

      expect(() => manager.capabilities('conn-1')).toThrow(ConnectionNotOpenError)
    })

    it('열려 있으면 드라이버의 capability 목록을 파생한다(acquire 없이)', async () => {
      const registry = new DriverRegistry()
      registry.register('postgres', (config) => ({
        id: config.id,
        engine: config.engine,
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        ping: () => Promise.resolve(1),
        sql: {} as unknown as NonNullable<Driver['sql']>,
        schema: {} as unknown as NonNullable<Driver['schema']>,
        data: {} as unknown as NonNullable<Driver['data']>,
      }))
      const manager = new PooledConnectionManager(registry, logger, {
        maxConcurrent: 2,
        queueTimeoutMs: 1000,
      })
      await manager.open(FAKE_CONFIG)

      expect(manager.capabilities('fake-1')).toEqual(['sql', 'schema', 'data'])
    })
  })

  it('같은 커넥션을 두 번 열어도 드라이버를 새로 만들지 않는다', async () => {
    const { manager, created } = createHarness(2)
    await manager.open(CONFIG)
    const first = await manager.acquire('conn-1')
    first.release()

    await manager.open(CONFIG)
    const second = await manager.acquire('conn-1')

    expect(second.driver).toBe(first.driver)
    // registry는 부를 때마다 새 인스턴스를 만든다. 두 번째 open이 create를
    // 다시 불렀다면 여기서 2가 된다 — 재사용을 registry 쪽에서 독립 확인한다.
    expect(created).toHaveLength(1)
    second.release()
  })

  it('이미 ready면 connect를 다시 부르지 않는다', async () => {
    const { manager, fakes } = createHarness(2)
    await manager.open(FAKE_CONFIG)
    await manager.open(FAKE_CONFIG)

    expect(fakes).toHaveLength(1)
    expect(fakes[0]?.calls.connect).toBe(1)
  })

  it('동시 실행 수를 제한한다', async () => {
    const manager = createManager(1)
    await manager.open(CONFIG)

    const first = await manager.acquire('conn-1')
    let secondAcquired = false
    const second = manager.acquire('conn-1').then((lease) => {
      secondAcquired = true
      return lease
    })

    await Promise.resolve()
    expect(secondAcquired).toBe(false)

    first.release()
    const lease = await second

    expect(secondAcquired).toBe(true)
    lease.release()
  })

  it('반납하면 대기 중인 요청이 순서대로 진행된다', async () => {
    const manager = createManager(1)
    await manager.open(CONFIG)

    const order: number[] = []
    const first = await manager.acquire('conn-1')

    const waiters = [1, 2, 3].map((n) =>
      manager.acquire('conn-1').then((lease) => {
        order.push(n)
        lease.release()
      }),
    )

    first.release()
    await Promise.all(waiters)

    expect(order).toEqual([1, 2, 3])
  })

  it('release를 두 번 불러도 슬롯이 두 번 열리지 않는다', async () => {
    const manager = createManager(1)
    await manager.open(CONFIG)

    const lease = await manager.acquire('conn-1')
    lease.release()
    lease.release()

    // 슬롯이 두 번 열렸다면 두 개를 동시에 임차할 수 있다.
    const a = await manager.acquire('conn-1')
    let bAcquired = false
    void manager.acquire('conn-1').then(() => {
      bAcquired = true
    })

    await Promise.resolve()

    expect(bAcquired).toBe(false)
    a.release()
  })

  it('대기가 타임아웃을 넘으면 거부한다', async () => {
    vi.useFakeTimers()
    const manager = createManager(1, 50)
    await manager.open(CONFIG)

    const held = await manager.acquire('conn-1')
    const pending = manager.acquire('conn-1')
    const assertion = expect(pending).rejects.toThrow(AcquireTimeoutError)

    await vi.advanceTimersByTimeAsync(51)
    await assertion

    held.release()
  })

  it('타임아웃 직전까지는 거부하지 않는다', async () => {
    vi.useFakeTimers()
    const manager = createManager(1, 50)
    await manager.open(CONFIG)

    const held = await manager.acquire('conn-1')
    let settled = false
    const pending = manager.acquire('conn-1')
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    await vi.advanceTimersByTimeAsync(49)
    expect(settled).toBe(false)

    held.release()
    const lease = await pending
    expect(lease.driver.id).toBe('conn-1')
    lease.release()
  })

  it('타임아웃된 대기자는 나중에 슬롯이 나도 임차하지 않는다', async () => {
    vi.useFakeTimers()
    const manager = createManager(1, 50)
    await manager.open(CONFIG)

    const held = await manager.acquire('conn-1')
    const pending = manager.acquire('conn-1')
    const assertion = expect(pending).rejects.toThrow(AcquireTimeoutError)

    await vi.advanceTimersByTimeAsync(51)
    await assertion

    // 타임아웃된 대기자가 큐에 남아 있으면 이 반납이 유령 대기자에게 간다.
    held.release()
    const next = await manager.acquire('conn-1')

    expect(next.driver.id).toBe('conn-1')
    next.release()
  })

  it('닫으면 closed가 되고 드라이버가 끊긴다', async () => {
    const manager = createManager(2)
    await manager.open(CONFIG)
    const lease = await manager.acquire('conn-1')
    const disconnect = vi.spyOn(lease.driver, 'disconnect')
    lease.release()

    await manager.close('conn-1')

    expect(manager.status('conn-1')).toBe('closed')
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('닫으면 대기 중인 요청을 거부한다', async () => {
    const manager = createManager(1)
    await manager.open(CONFIG)

    // 슬롯을 잡은 채로 닫는다. 여기서 release를 먼저 부르면 대기자가
    // 정상적으로 슬롯을 받아버려서 close의 거부 경로를 검증하지 못한다.
    await manager.acquire('conn-1')
    const pending = manager.acquire('conn-1')
    const assertion = expect(pending).rejects.toThrow(ConnectionNotOpenError)

    await manager.close('conn-1')
    await assertion
  })

  it('닫은 뒤 다시 열 수 있다', async () => {
    const manager = createManager(2)
    await manager.open(CONFIG)
    await manager.close('conn-1')
    await manager.open(CONFIG)

    expect(manager.status('conn-1')).toBe('ready')
  })

  it('닫은 뒤 다시 열면 새 드라이버를 만든다', async () => {
    const { manager, created } = createHarness(2)
    await manager.open(CONFIG)
    const before = await manager.acquire('conn-1')
    before.release()

    await manager.close('conn-1')
    await manager.open(CONFIG)
    const after = await manager.acquire('conn-1')

    // 끊긴 드라이버를 재사용하면 이후 모든 질의가 죽은 소켓으로 나간다.
    expect(after.driver).not.toBe(before.driver)
    expect(created).toHaveLength(2)
    after.release()
  })

  it('열지 않은 커넥션을 닫아도 아무 일도 없다', async () => {
    const manager = createManager(2)

    await expect(manager.close('conn-1')).resolves.toBeUndefined()
    expect(manager.status('conn-1')).toBe('closed')
  })

  it('두 번 닫아도 disconnect는 한 번만 돈다', async () => {
    const { manager, fakes } = createHarness(2)
    await manager.open(FAKE_CONFIG)

    await manager.close('fake-1')
    await manager.close('fake-1')

    expect(fakes[0]?.calls.disconnect).toBe(1)
  })

  it('반납되지 않은 임차가 있어도 기다리지 않고 닫는다', async () => {
    const { manager, fakes } = createHarness(2)
    await manager.open(FAKE_CONFIG)
    const lease = await manager.acquire('fake-1')

    await manager.close('fake-1')

    expect(manager.status('fake-1')).toBe('closed')
    expect(fakes[0]?.calls.disconnect).toBe(1)

    // 폐기된 항목에 슬롯을 되돌려도 아무 효과가 없어야 한다.
    expect(() => {
      lease.release()
    }).not.toThrow()
    expect(manager.status('fake-1')).toBe('closed')
  })

  it('closeAll은 열린 커넥션을 모두 닫는다', async () => {
    const { manager, fakes } = createHarness(2)
    await manager.open(FAKE_CONFIG)
    await manager.open({ ...FAKE_CONFIG, id: 'fake-2' })

    await manager.closeAll()

    expect(manager.status('fake-1')).toBe('closed')
    expect(manager.status('fake-2')).toBe('closed')
    expect(fakes.map((f) => f.calls.disconnect)).toEqual([1, 1])
  })

  it('여러 커넥션의 슬롯이 서로 독립적이다', async () => {
    const manager = createManager(1)
    await manager.open(CONFIG)
    await manager.open({ ...CONFIG, id: 'conn-2' })

    const a = await manager.acquire('conn-1')
    const b = await manager.acquire('conn-2')

    expect(a.driver.id).toBe('conn-1')
    expect(b.driver.id).toBe('conn-2')

    a.release()
    b.release()
  })

  describe('connect 실패', () => {
    it('실패를 그대로 던지고 error 상태가 된다', async () => {
      const { manager } = createHarness(2, 1000, { failConnectOn: [1] })

      await expect(manager.open(FAKE_CONFIG)).rejects.toThrow('connect failed on attempt 1')
      expect(manager.status('fake-1')).toBe('error')
    })

    it('실패한 커넥션은 임차할 수 없다', async () => {
      const { manager } = createHarness(2, 1000, { failConnectOn: [1] })
      await expect(manager.open(FAKE_CONFIG)).rejects.toThrow()

      await expect(manager.acquire('fake-1')).rejects.toThrow(ConnectionNotOpenError)
    })

    it('실패를 성공으로 캐시하지 않고 다시 열면 재시도한다', async () => {
      const { manager, fakes } = createHarness(2, 1000, { failConnectOn: [1] })
      await expect(manager.open(FAKE_CONFIG)).rejects.toThrow()

      await manager.open(FAKE_CONFIG)

      expect(manager.status('fake-1')).toBe('ready')
      // 첫 시도의 드라이버와 재시도의 드라이버는 별개다.
      expect(fakes).toHaveLength(2)
      expect(fakes[1]?.calls.connect).toBe(1)
    })

    /**
     * 실패한 드라이버가 붙들고 있는 소켓을 놓아주는지 본다.
     *
     * `pg`/`mysql2` 같은 실제 클라이언트는 인증하기 **전에** TCP/TLS 소켓을
     * 연다. 그래서 인증 실패로 connect가 거부되어도 소켓은 살아 있다. 'error'
     * 항목은 다음 open()에서 새 드라이버로 교체되므로, 끊어 주지 않으면 그
     * 순간 참조를 잃고 프로세스가 끝날 때까지 서버 쪽 커넥션이 남는다 —
     * 비밀번호를 한 번 잘못 칠 때마다 하나씩.
     */
    it('실패한 드라이버를 끊어 소켓을 남기지 않는다', async () => {
      const { manager, fakes } = createHarness(2, 1000, { failConnectOn: [1] })

      await expect(manager.open(FAKE_CONFIG)).rejects.toThrow()

      expect(fakes[0]?.calls.disconnect).toBe(1)
    })

    it('실패 후 재시도해도 첫 드라이버가 정확히 한 번 끊긴다', async () => {
      // 사용자가 비밀번호를 잘못 치고, 고쳐서 다시 연결하고, 앱을 닫는 경로.
      const { manager, fakes } = createHarness(2, 1000, { failConnectOn: [1] })

      await expect(manager.open(FAKE_CONFIG)).rejects.toThrow()
      await manager.open(FAKE_CONFIG)
      await manager.closeAll()

      expect(fakes).toHaveLength(2)
      // 실패한 첫 드라이버: 교체되어 사라지기 전에 이미 끊겼다. 두 번 끊지도
      // 않는다 — closeAll이 보는 것은 재시도로 들어선 두 번째 드라이버다.
      expect(fakes[0]?.calls.disconnect).toBe(1)
      expect(fakes[1]?.calls.disconnect).toBe(1)
    })

    it('정리 중의 disconnect 실패가 원래 connect 실패를 가리지 않는다', async () => {
      // 호출자가 알아야 하는 것은 "비밀번호가 틀렸다"이지, 그 뒤처리에서 난
      // 이차적 실패가 아니다. 정리 실패가 던져 올라오면 사용자는 엉뚱한 것을
      // 고치게 된다.
      const { manager, fakes } = createHarness(2, 1000, {
        failConnectOn: [1],
        failDisconnect: true,
      })

      await expect(manager.open(FAKE_CONFIG)).rejects.toThrow('connect failed on attempt 1')

      // 시도는 했다 — 삼킨 것이지 건너뛴 것이 아니다.
      expect(fakes[0]?.calls.disconnect).toBe(1)
      expect(logger.warn).toHaveBeenCalledWith('connection.failed_driver_dispose_failed', {
        connectionId: 'fake-1',
        message: 'disconnect failed',
      })
    })

    it('실패를 로그로 남긴다', async () => {
      const { manager } = createHarness(2, 1000, { failConnectOn: [1] })
      await expect(manager.open(FAKE_CONFIG)).rejects.toThrow()

      expect(logger.warn).toHaveBeenCalledWith('connection.open_failed', {
        connectionId: 'fake-1',
        message: 'connect failed on attempt 1',
      })
    })
  })

  describe('동시 open', () => {
    it('같은 id로 동시에 열어도 connect는 한 번만 돈다', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { manager, created, fakes } = createHarness(2, 1000, { gate })

      const first = manager.open(FAKE_CONFIG)
      const second = manager.open(FAKE_CONFIG)
      const third = manager.open(FAKE_CONFIG)

      release()
      await Promise.all([first, second, third])

      expect(created).toHaveLength(1)
      expect(fakes[0]?.calls.connect).toBe(1)
      expect(manager.status('fake-1')).toBe('ready')
    })

    it('연결이 진행 중이면 connecting이고 임차는 거부한다', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { manager } = createHarness(2, 1000, { gate })

      const opening = manager.open(FAKE_CONFIG)
      await Promise.resolve()

      expect(manager.status('fake-1')).toBe('connecting')
      await expect(manager.acquire('fake-1')).rejects.toThrow(ConnectionNotOpenError)

      release()
      await opening
      expect(manager.status('fake-1')).toBe('ready')
    })

    it('동시 open이 실패하면 모든 호출자가 같은 에러를 받는다', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { manager, fakes } = createHarness(2, 1000, { gate, failConnectOn: [1] })

      const first = manager.open(FAKE_CONFIG)
      const second = manager.open(FAKE_CONFIG)
      release()

      await expect(first).rejects.toThrow('connect failed on attempt 1')
      await expect(second).rejects.toThrow('connect failed on attempt 1')
      expect(fakes[0]?.calls.connect).toBe(1)
      expect(manager.status('fake-1')).toBe('error')
    })

    it('연결 중에 닫으면 open이 거부되고 드라이버는 한 번 끊긴다', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { manager, fakes } = createHarness(2, 1000, { gate })

      const opening = manager.open(FAKE_CONFIG)
      await Promise.resolve()
      const closing = manager.close('fake-1')

      release()
      await expect(opening).rejects.toThrow(ConnectionNotOpenError)
      await closing

      expect(manager.status('fake-1')).toBe('closed')
      // 연결까지 간 드라이버를 끊지 않으면 소켓이 샌다. 두 번 끊어도 안 된다.
      expect(fakes[0]?.calls.disconnect).toBe(1)
    })

    it('연결 중에 닫으면 close가 실제로 끊긴 뒤에 끝난다', async () => {
      // close가 disconnect를 기다리지 않고 먼저 resolve하면, 종료 경로에서
      // `await closeAll()` 다음에 app.quit()이 돌아 방금 열린 서버 쪽 커넥션이
      // 주인 없이 남는다. closeAll의 존재 이유가 종료 경로이므로 치명적이다.
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { manager, fakes } = createHarness(2, 1000, { gate })

      const opening = manager.open(FAKE_CONFIG)
      // opening을 여기서 await하면 안 된다. 먼저 기다려 버리면 connectEntry의
      // 정리가 이미 끝난 뒤에 close를 확인하게 되어, close가 기다리든 말든
      // 통과한다 — 그러면 이 테스트가 아무것도 지키지 못한다.
      const openingSettled = opening.catch(() => undefined)
      await Promise.resolve()
      const closing = manager.close('fake-1')

      release()
      await closing

      // close가 끝난 "그 시점에" 이미 끊겨 있어야 한다. 나중에 결국 끊기는 것으로는
      // 부족하다 — 그 사이에 프로세스가 죽는 게 정확히 문제 상황이다.
      expect(fakes[0]?.calls.disconnect).toBe(1)
      await expect(opening).rejects.toThrow(ConnectionNotOpenError)
      await openingSettled
    })

    it('연결 중에 closeAll을 불러도 실제로 끊긴 뒤에 끝난다', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { manager, fakes } = createHarness(2, 1000, { gate })

      const opening = manager.open(FAKE_CONFIG)
      const openingSettled = opening.catch(() => undefined)
      await Promise.resolve()
      const closing = manager.closeAll()

      release()
      await closing

      expect(fakes[0]?.calls.disconnect).toBe(1)
      await expect(opening).rejects.toThrow(ConnectionNotOpenError)
      await openingSettled
    })
  })

  describe('config 변경 감지', () => {
    it('열려 있는 커넥션을 다른 config로 열려 하면 거부한다', async () => {
      const { manager, fakes } = createHarness(2, 1000)
      await manager.open(FAKE_CONFIG)

      // 사용자가 host를 고치고 다시 연결한 상황. 조용히 무시하면 옛 서버의 답이
      // 새 설정의 답으로 둔갑한다.
      await expect(
        manager.open({ ...FAKE_CONFIG, host: 'other.example.com' }),
      ).rejects.toThrow(ConnectionConfigChangedError)

      // 거부만 하고 살아 있는 커넥션을 건드리지는 않는다.
      expect(manager.status('fake-1')).toBe('ready')
      expect(fakes[0]?.calls.disconnect).toBe(0)
    })

    it('같은 config면 키 순서가 달라도 재사용한다', async () => {
      const { manager, created } = createHarness(2, 1000)
      await manager.open(FAKE_CONFIG)

      const reordered = Object.fromEntries(
        Object.entries(FAKE_CONFIG).reverse(),
      ) as typeof FAKE_CONFIG

      await manager.open(reordered)

      expect(created).toHaveLength(1)
    })

    it('닫은 뒤에는 새 config로 열 수 있다', async () => {
      const { manager } = createHarness(2, 1000)
      await manager.open(FAKE_CONFIG)
      await manager.close('fake-1')

      await expect(
        manager.open({ ...FAKE_CONFIG, host: 'other.example.com' }),
      ).resolves.toBeUndefined()
      expect(manager.status('fake-1')).toBe('ready')
    })

    it('연결이 진행 중일 때 다른 config로 열려 해도 거부한다', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { manager } = createHarness(2, 1000, { gate })

      const opening = manager.open(FAKE_CONFIG)
      await Promise.resolve()

      await expect(
        manager.open({ ...FAKE_CONFIG, database: 'other' }),
      ).rejects.toThrow(ConnectionConfigChangedError)

      release()
      await opening
    })
  })

  describe('checkHealth', () => {
    it('살아 있으면 true고 ping을 실제로 부른다', async () => {
      const { manager, fakes } = createHarness(2)
      await manager.open(FAKE_CONFIG)

      await expect(manager.checkHealth('fake-1')).resolves.toBe(true)
      expect(fakes[0]?.calls.ping).toBe(1)
      expect(manager.status('fake-1')).toBe('ready')
    })

    it('ping이 실패하면 false고 상태가 error로 내려간다', async () => {
      const { manager } = createHarness(2, 1000, { failPing: true })
      await manager.open(FAKE_CONFIG)

      await expect(manager.checkHealth('fake-1')).resolves.toBe(false)
      expect(manager.status('fake-1')).toBe('error')
    })

    it('죽은 커넥션은 이후 임차가 거부된다', async () => {
      const { manager } = createHarness(2, 1000, { failPing: true })
      await manager.open(FAKE_CONFIG)
      await manager.checkHealth('fake-1')

      await expect(manager.acquire('fake-1')).rejects.toThrow(ConnectionNotOpenError)
    })

    it('죽은 커넥션을 몰래 다시 연결하지 않는다', async () => {
      const { manager, created, fakes } = createHarness(2, 1000, { failPing: true })
      await manager.open(FAKE_CONFIG)
      await manager.checkHealth('fake-1')

      // 자동 복구는 세션 상태를 말없이 날린다. 되살리는 판단은 호출자 몫이다.
      expect(created).toHaveLength(1)
      expect(fakes[0]?.calls.connect).toBe(1)
    })

    it('열려 있지 않으면 ping 없이 false다', async () => {
      const { manager, fakes } = createHarness(2)

      await expect(manager.checkHealth('fake-1')).resolves.toBe(false)
      expect(fakes).toHaveLength(0)
    })

    it('ping 실패를 로그로 남긴다', async () => {
      const { manager } = createHarness(2, 1000, { failPing: true })
      await manager.open(FAKE_CONFIG)
      await manager.checkHealth('fake-1')

      expect(logger.warn).toHaveBeenCalledWith('connection.health_check_failed', {
        connectionId: 'fake-1',
        message: 'ping failed',
      })
    })
  })

  describe('임차 취소 신호', () => {
    it('새 임차의 signal은 발화하지 않은 상태다', async () => {
      const manager = createManager(2)
      await manager.open(CONFIG)

      const lease = await manager.acquire('conn-1')

      expect(lease.signal.aborted).toBe(false)
      lease.release()
    })

    it('커넥션을 닫으면 살아 있는 임차의 signal이 발화한다', async () => {
      const manager = createManager(2)
      await manager.open(CONFIG)
      const lease = await manager.acquire('conn-1')

      await manager.close('conn-1')

      expect(lease.signal.aborted).toBe(true)
    })

    it('closeAll도 살아 있는 임차에 알린다', async () => {
      const manager = createManager(2)
      await manager.open(CONFIG)
      const lease = await manager.acquire('conn-1')

      await manager.closeAll()

      expect(lease.signal.aborted).toBe(true)
    })

    it('반납한 임차는 이후 close에 반응하지 않는다', async () => {
      // 반납 후에도 남아 있으면 컨트롤러가 계속 쌓인다.
      const manager = createManager(2)
      await manager.open(CONFIG)
      const lease = await manager.acquire('conn-1')
      lease.release()

      await manager.close('conn-1')

      expect(lease.signal.aborted).toBe(false)
    })

    it('두 임차를 모두 깨운다', async () => {
      const manager = createManager(2)
      await manager.open(CONFIG)
      const first = await manager.acquire('conn-1')
      const second = await manager.acquire('conn-1')

      await manager.close('conn-1')

      expect([first.signal.aborted, second.signal.aborted]).toEqual([true, true])
    })
  })
})
