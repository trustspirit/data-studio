import type { ConnectionConfig } from '../../../shared/types/connection'
import type {
  ConnectionManager,
  ConnectionStatus,
  LeasedConnection,
} from '../../core/connection/ConnectionManager'
import type { Driver } from '../../core/driver/Driver'
import type { DriverRegistry } from '../../core/driver/DriverRegistry'
import type { Logger } from '../../core/ports/Logger'

export class ConnectionNotOpenError extends Error {
  constructor(readonly connectionId: string) {
    super(`connection is not open: ${connectionId}`)
    this.name = 'ConnectionNotOpenError'
  }
}

export class AcquireTimeoutError extends Error {
  constructor(
    readonly connectionId: string,
    readonly waitedMs: number,
  ) {
    super(`timed out waiting ${waitedMs}ms for a slot on ${connectionId}`)
    this.name = 'AcquireTimeoutError'
  }
}

export class ConnectionConfigChangedError extends Error {
  constructor(readonly connectionId: string) {
    super(`connection ${connectionId} is already open with a different config`)
    this.name = 'ConnectionConfigChangedError'
  }
}

/**
 * config를 키 순서에 무관한 문자열로 만든다. 두 config가 같은 대상을 가리키는지
 * 판단하는 유일한 기준이다.
 *
 * 필드를 골라 비교하지 않고 **전부** 비교한다. 골라내면 나중에 필드가 추가될 때
 * 조용히 비교 대상에서 빠지고, 그때 생기는 증상이 "설정을 바꿨는데 옛 서버에
 * 붙어 있다"라는 알아채기 어려운 형태다. 전부 비교하면 무해한 변경까지
 * 거부당하지만, 그건 close 후 열면 되는 눈에 보이는 불편이다.
 */
function fingerprint(config: ConnectionConfig): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b))),
  )
}

export interface PoolOptions {
  /** 커넥션당 동시에 실행할 수 있는 작업 수 */
  readonly maxConcurrent: number
  /** 슬롯을 기다리는 최대 시간 */
  readonly queueTimeoutMs: number
}

interface Waiter {
  resolve(lease: LeasedConnection): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  settled: boolean
}

interface Entry {
  readonly driver: Driver
  /**
   * 이 커넥션을 연 config의 지문. 저장해 두지 않으면 "다른 config로 다시 열려는
   * 시도"를 원리적으로 감지할 수 없다 — 규칙을 문서에만 적어 두는 것과 같다.
   */
  readonly fingerprint: string
  status: ConnectionStatus
  inUse: number
  waiters: Waiter[]
  /**
   * 진행 중인 `connect`. 같은 id로 들어온 동시 `open`들이 이걸 함께 기다린다 —
   * 없으면 호출자 수만큼 드라이버가 만들어지고 connect가 그만큼 돌아서,
   * 마지막 하나만 map에 남고 나머지는 연결된 채 영영 새어 나간다.
   */
  opening: Promise<void> | null
  /** 폐기된 항목. 남아 있던 임차의 반납이 슬롯을 되돌리지 못하게 막는다. */
  discarded: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 커넥션 생명주기와 동시 실행 제한을 담당한다.
 *
 * 왜 필요한가: `DriverRegistry`는 부를 때마다 새 드라이버를 만들 뿐 connect도
 * disconnect도 하지 않는 무상태 팩토리다. 누군가는 "이 커넥션 id에 대응하는
 * 살아 있는 드라이버는 정확히 하나"를 지켜야 하고, 그게 여기다.
 *
 * 그리고 DB 커넥션은 유한 자원이다. 사용자가 큰 쿼리 여러 개를 동시에 던지면
 * 서버 쪽 커넥션 한도를 소진시켜 앱 전체가 멈춘다. 슬롯을 두고 대기시키되
 * 대기 자체에도 타임아웃을 걸어, 영원히 매달린 요청이 쌓이지 않게 한다.
 */
export class PooledConnectionManager implements ConnectionManager {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly registry: DriverRegistry,
    private readonly logger: Logger,
    private readonly options: PoolOptions,
  ) {}

  open(config: ConnectionConfig): Promise<void> {
    const existing = this.entries.get(config.id)
    const print = fingerprint(config)

    if (existing !== undefined) {
      // 살아 있는 항목에 대해서만 따진다. 'error'로 주저앉은 항목은 어차피 아래에서
      // 새 드라이버로 재시도하므로, 그때는 새 config가 그대로 적용된다.
      if (
        (existing.status === 'ready' || existing.opening !== null) &&
        existing.fingerprint !== print
      ) {
        return Promise.reject(new ConnectionConfigChangedError(config.id))
      }

      if (existing.status === 'ready') return Promise.resolve()
      if (existing.opening !== null) return existing.opening
      // 'error'로 주저앉은 항목은 재시도 대상이다. 실패를 성공으로 캐시하지
      // 않으므로 아래로 떨어져 드라이버를 새로 만든다 — 실패한 드라이버를
      // 재사용하면 어떤 절반쯤 열린 상태를 물려받는지 알 수 없다.
    }

    const entry: Entry = {
      driver: this.registry.create(config),
      fingerprint: print,
      status: 'connecting',
      inUse: 0,
      waiters: [],
      opening: null,
      discarded: false,
    }
    this.entries.set(config.id, entry)

    const opening = this.connectEntry(config, entry)
    entry.opening = opening
    return opening
  }

  private async connectEntry(config: ConnectionConfig, entry: Entry): Promise<void> {
    try {
      await entry.driver.connect(config)
    } catch (error) {
      entry.opening = null
      entry.status = 'error'
      this.logger.warn('connection.open_failed', {
        connectionId: config.id,
        message: messageOf(error),
      })
      throw error
    }

    entry.opening = null

    if (this.entries.get(config.id) !== entry) {
      // 연결하는 사이에 close가 들어왔다. close는 아직 연결되지 않은 드라이버를
      // 끊지 않고 이 경로에 맡긴다 — 그래야 disconnect가 정확히 한 번 돌고,
      // 방금 열린 소켓이 주인 없이 남지 않는다.
      await entry.driver.disconnect()
      throw new ConnectionNotOpenError(config.id)
    }

    entry.status = 'ready'
  }

  status(connectionId: string): ConnectionStatus {
    return this.entries.get(connectionId)?.status ?? 'closed'
  }

  acquire(connectionId: string): Promise<LeasedConnection> {
    const entry = this.entries.get(connectionId)
    if (entry === undefined || entry.status !== 'ready') {
      return Promise.reject(new ConnectionNotOpenError(connectionId))
    }

    if (entry.inUse < this.options.maxConcurrent) {
      entry.inUse += 1
      return Promise.resolve(this.makeLease(connectionId, entry))
    }

    return new Promise<LeasedConnection>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        settled: false,
        timer: setTimeout(() => {
          if (waiter.settled) return
          waiter.settled = true
          // 큐에서 빼지 않으면 나중의 release가 유령 대기자에게 슬롯을 넘긴다.
          entry.waiters = entry.waiters.filter((w) => w !== waiter)
          this.logger.warn('connection.acquire_timeout', {
            connectionId,
            waitedMs: this.options.queueTimeoutMs,
          })
          reject(new AcquireTimeoutError(connectionId, this.options.queueTimeoutMs))
        }, this.options.queueTimeoutMs),
      }

      entry.waiters.push(waiter)
    })
  }

  async close(connectionId: string): Promise<void> {
    const entry = this.entries.get(connectionId)
    if (entry === undefined) return

    // 먼저 map에서 뗀다. 그래야 await 사이에 들어온 open이 폐기 중인 항목을
    // 되살리지 못하고, 두 번째 close는 아무것도 찾지 못해 disconnect를
    // 두 번 부르지 않는다.
    this.entries.delete(connectionId)
    entry.discarded = true

    for (const waiter of entry.waiters) {
      if (waiter.settled) continue
      waiter.settled = true
      clearTimeout(waiter.timer)
      waiter.reject(new ConnectionNotOpenError(connectionId))
    }
    entry.waiters = []
    entry.status = 'closed'

    // 아직 연결 중이면 여기서 직접 끊지 않는다 — connectEntry가 자기가 연 소켓을
    // 책임지고 닫는다. 여기서도 끊으면 아직 열리지 않은 드라이버에
    // disconnect가 가고, 이어서 한 번 더 간다.
    //
    // 다만 그 정리가 끝날 때까지 **기다린다**. 그냥 돌아가면 close가 소켓이 실제로
    // 닫히기 전에 resolve하고, `await closeAll()` 뒤 app.quit()이 방금 열린
    // 서버 쪽 커넥션을 주인 없이 남긴 채 프로세스를 끝낸다. closeAll의 존재
    // 이유가 종료 경로인 만큼 여기서 기다리지 않으면 의미가 없다.
    //
    // connectEntry는 이 경로에서 ConnectionNotOpenError를 던지도록 되어 있고
    // 그 거부는 open()의 호출자가 받는다. 여기서는 이미 close를 요청한
    // 상황이므로 삼킨다 — 안 삼키면 close가 남의 에러로 실패한다.
    if (entry.opening !== null) {
      await entry.opening.catch(() => undefined)
      return
    }

    await entry.driver.disconnect()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)))
  }

  async checkHealth(connectionId: string): Promise<boolean> {
    const entry = this.entries.get(connectionId)
    if (entry === undefined || entry.status !== 'ready') return false

    try {
      await entry.driver.ping()
      return true
    } catch (error) {
      // 상태만 내리고 재연결은 하지 않는다. 몰래 갈아끼우면 세션에 매달린
      // 상태(임시 테이블, 열린 트랜잭션, SET)가 말없이 사라진다.
      if (!entry.discarded) entry.status = 'error'
      this.logger.warn('connection.health_check_failed', {
        connectionId,
        message: messageOf(error),
      })
      return false
    }
  }

  private makeLease(connectionId: string, entry: Entry): LeasedConnection {
    let released = false

    return {
      driver: entry.driver,
      release: () => {
        // 중복 반납을 무시하지 않으면 슬롯이 실제보다 많이 열려
        // 동시 실행 제한이 무력화된다.
        if (released) return
        released = true

        // 이미 닫힌 커넥션에 슬롯을 되돌려도 의미가 없고, 폐기된 큐에 남은
        // 대기자를 깨우면 끊긴 드라이버를 넘기게 된다.
        if (entry.discarded) return

        const next = entry.waiters.shift()
        if (next !== undefined && !next.settled) {
          next.settled = true
          clearTimeout(next.timer)
          next.resolve(this.makeLease(connectionId, entry))
          return
        }

        entry.inUse -= 1
      },
    }
  }
}
