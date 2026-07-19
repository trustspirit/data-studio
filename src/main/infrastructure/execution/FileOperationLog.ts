import { appendFile, readFile } from 'node:fs/promises'
import type {
  OperationLog,
  OperationLogEntry,
  OperationLogInput,
} from '../../core/execution/OperationLog'
import type { Logger } from '../../core/ports/Logger'

export interface LogClock {
  readonly now: () => number
}

/**
 * 감사 로그를 append-only 파일로 지속한다.
 *
 * 인메모리 로그는 프로세스와 함께 사라진다 — AI가 유발한 사고는 크래시를
 * 동반할 가능성이 평균보다 높으므로, 감사 로그가 죽으면 정작 필요할 때 무슨
 * 일이 있었는지 알 수 없다.
 *
 * **두 가지 시그니처 제약을 이렇게 푼다:**
 * 1. `OperationLog`의 `record`/`recent`는 동기다. 파일 I/O는 비동기다. 그래서
 *    인메모리 미러를 둔다: 생성 시 파일을 한 번 읽어 메모리에 적재하고,
 *    `record`는 메모리에 즉시 넣은 뒤 파일 append를 백그라운드 큐로 넘긴다.
 *    `recent`는 메모리에서 동기로 답한다. 생성이 async이므로 정적 팩토리로 만든다.
 * 2. append에는 전체 덮어쓰기(atomicWrite)가 아니라 `appendFile`을 쓴다.
 *    덮어쓰기로 관리하면 매 기록마다 전체 파일을 다시 써 append-only가 아니게 된다.
 *
 * 쓰기 실패는 삼킨다 — 감사 기록 실패가 실행 자체를 막아선 안 된다. 다만
 * 조용히 삼키면 파일이 안 써지는데 아무도 모르므로 **횟수를 센다**
 * (`droppedCount`). 이 값의 의미는 인메모리 백엔드와 다르다: 거기서는 용량
 * 축출 수였고, 여기서는 쓰기 실패 수다.
 *
 * 파일이 무한히 커지는 것(로테이션)은 이 단계에서 다루지 않는다 — 감사 로그는
 * 지우기보다 커지는 쪽이 안전하고, 로테이션은 별도 관심사다.
 */
export class FileOperationLog implements OperationLog {
  private readonly entries: OperationLogEntry[] = []
  private writeQueue: Promise<void> = Promise.resolve()
  private writeFailures = 0

  private constructor(
    private readonly filePath: string,
    private readonly clock: LogClock,
    private readonly logger: Logger,
    loaded: readonly OperationLogEntry[],
  ) {
    this.entries.push(...loaded)
  }

  static async create(
    filePath: string,
    clock: LogClock,
    logger: Logger,
  ): Promise<FileOperationLog> {
    const loaded = await FileOperationLog.load(filePath)
    return new FileOperationLog(filePath, clock, logger, loaded)
  }

  private static async load(filePath: string): Promise<OperationLogEntry[]> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch {
      // 파일이 아직 없다 — 첫 실행이다. 빈 이력으로 시작한다.
      return []
    }

    const entries: OperationLogEntry[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      try {
        // 손상된 한 줄이 전체 이력을 못 읽게 만들면 안 된다. 그 줄만 건너뛴다.
        entries.push(JSON.parse(line) as OperationLogEntry)
      } catch {
        // 부분 기록으로 잘린 줄 등. 무시하고 나머지를 살린다.
      }
    }
    return entries
  }

  record(input: OperationLogInput): void {
    // 입력 객체를 그대로 담지 않는다. 호출자가 나중에 그 객체를 고치면 이미
    // 기록된 감사 항목이 따라 바뀐다.
    const entry: OperationLogEntry = { ...input, at: this.clock.now() }
    this.entries.push(entry)

    const line = `${JSON.stringify(entry)}\n`
    // 이전 append의 promise에 체이닝해 순서를 보장한다. 순서가 어긋나면
    // 재시작 후 읽은 순서가 기록 순서와 달라진다.
    this.writeQueue = this.writeQueue.then(
      () =>
        appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 }).catch((error: unknown) => {
          this.writeFailures += 1
          this.logger.warn('audit.write_failed', {
            message: error instanceof Error ? error.message : String(error),
          })
        }),
      () => undefined,
    )
  }

  recent(limit: number): readonly OperationLogEntry[] {
    if (limit <= 0) return []
    return this.entries
      .slice(-limit)
      .reverse()
      .map((entry) => ({ ...entry }))
  }

  /** append-only라 용량 축출은 없다. 이 값은 **쓰기 실패 수**다. */
  droppedCount(): number {
    return this.writeFailures
  }

  /** 큐에 쌓인 파일 쓰기가 끝날 때까지 기다린다. 종료 경로와 테스트에서 쓴다. */
  async flush(): Promise<void> {
    await this.writeQueue
  }
}
