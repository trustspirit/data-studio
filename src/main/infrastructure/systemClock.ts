import { createHash, randomUUID } from 'node:crypto'

/**
 * 지금까지 모든 시간·난수·해시는 주입 대상이었다 — 만료·1회용·순서를 결정적으로
 * 테스트하기 위해서다. 컴포지션 루트가 주입할 **실제 구현**을 여기 모은다.
 *
 * Node crypto를 쓰므로 `infrastructure`에 둔다(core도 shared도 아니다).
 */

export const systemClock = {
  now: (): number => Date.now(),
}

/** `OperationExecutor`의 `ExecutorClock` 형태. */
export const systemTimers = {
  now: (): number => Date.now(),
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown): void => {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

/**
 * 쓰기 제안서의 `proposalId`가 된다.
 *
 * `randomUUID`는 암호학적으로 안전하다 — `WriteProposalStore`가 요구하는
 * 조건이다. 추측 가능한 id면 침해된 renderer가 아직 승인되지 않은 제안서를
 * 맞혀 승인시킬 수 있다.
 */
export function randomId(): string {
  return randomUUID()
}

/** 문장의 SHA-256을 hex로. 제안서와 실행 기록을 대조하는 데 쓴다. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
