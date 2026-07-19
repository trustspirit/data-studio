import type {
  OperationLog,
  OperationLogEntry,
  OperationLogInput,
} from '../../core/execution/OperationLog'

export interface LogClock {
  readonly now: () => number
}

export const DEFAULT_LOG_CAPACITY = 5_000

/**
 * 프로세스 수명 동안만 유지되는 감사 로그.
 *
 * 0c에서 파일 백엔드로 교체한다(`atomicWrite`가 이미 있다). 지금 파일로
 * 만들지 않는 이유는 관문을 먼저 완성하기 위해서이고, 포트를 통해 쓰므로
 * 교체 시 `OperationExecutor`는 손대지 않는다.
 *
 * **알려진 한계:** 프로세스가 죽으면 기록이 사라진다. 감사 로그로서 이는
 * 진짜 결함이므로 0c에서 반드시 파일 백엔드를 붙여야 한다 — 이 클래스를
 * 최종본으로 오해하지 말 것.
 */
export class InMemoryOperationLog implements OperationLog {
  private readonly entries: OperationLogEntry[] = []
  private dropped = 0

  constructor(
    private readonly clock: LogClock,
    private readonly capacity: number = DEFAULT_LOG_CAPACITY,
  ) {}

  record(input: OperationLogInput): void {
    // 입력 객체를 그대로 담지 않는다. 호출자가 나중에 그 객체를 고치면
    // 이미 기록된 감사 항목이 따라 바뀐다.
    this.entries.push({ ...input, at: this.clock.now() })

    // 무한히 쌓이면 장시간 세션에서 메모리를 먹는다. 오래된 것부터 버리되,
    // 버린 개수를 세어 손실이 조용해지지 않게 한다 — AI는 거부 요청을
    // 무제한 유발할 수 있고, 그것만으로 자기 이전 기록을 밀어낼 수 있다.
    while (this.entries.length > this.capacity) {
      this.entries.shift()
      this.dropped += 1
    }
  }

  droppedCount(): number {
    return this.dropped
  }

  recent(limit: number): readonly OperationLogEntry[] {
    // slice(-0)은 배열 전체를 돌려준다. 0을 명시적으로 처리하지 않으면
    // "0개 달라"는 호출자가 로그 전체를 받는다.
    if (limit <= 0) return []

    // 항목까지 복사한다. 배열만 복사하면 조회한 쪽이 감사 기록의 내용을
    // 고칠 수 있고, 감사 로그에서는 그게 정확히 막아야 할 일이다.
    return this.entries
      .slice(-limit)
      .reverse()
      .map((entry) => ({ ...entry }))
  }
}
