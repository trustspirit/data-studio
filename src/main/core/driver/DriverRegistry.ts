import type { ConnectionConfig, EngineId } from '../../../shared/types/connection'
import type { Driver } from './Driver'

export type DriverFactory = (config: ConnectionConfig) => Driver

export class UnsupportedEngineError extends Error {
  constructor(readonly engine: EngineId) {
    super(`no driver registered for engine: ${engine}`)
    this.name = 'UnsupportedEngineError'
  }
}

/**
 * 엔진 식별자를 드라이버 팩토리에 연결한다.
 *
 * 새 엔진 추가 = 드라이버 파일 하나 + 계약 테스트 통과 + 여기 등록 한 줄.
 * 상위 코드(ConnectionManager, OperationExecutor)는 손대지 않는다.
 *
 * 싱글턴을 export하지 않는다 — 컴포지션 루트가 인스턴스를 만들어 주입하고,
 * 테스트는 격리된 인스턴스를 쓴다.
 */
export class DriverRegistry {
  private readonly factories = new Map<EngineId, DriverFactory>()

  /**
   * 중복 등록은 조용히 덮어쓰지 않고 던진다. 덮어쓰면 어느 구현이 실제로
   * 도는지 실행 시점까지 알 수 없다.
   */
  register(engine: EngineId, factory: DriverFactory): void {
    if (this.factories.has(engine)) {
      throw new Error(`driver already registered for engine: ${engine}`)
    }
    this.factories.set(engine, factory)
  }

  supports(engine: EngineId): boolean {
    return this.factories.has(engine)
  }

  registeredEngines(): readonly EngineId[] {
    return [...this.factories.keys()]
  }

  create(config: ConnectionConfig): Driver {
    const factory = this.factories.get(config.engine)
    if (factory === undefined) {
      throw new UnsupportedEngineError(config.engine)
    }
    return factory(config)
  }
}
