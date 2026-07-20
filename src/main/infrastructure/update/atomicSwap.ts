/**
 * 앱을 원자적으로 교체하고, 어느 단계가 실패하든 rollback한다.
 *
 * 핵심 불변식: **어떤 실패 경로에서도 제자리(`appPath`)에 앱이 없는 상태로
 * 남지 않는다.** 업데이트가 앱을 지워 놓고 죽으면 사용자는 실행할 앱을 잃는다.
 *
 * fs 연산을 주입받는다 — 실제 fs는 index.ts가, 테스트는 가짜가 준다.
 */

export interface SwapFs {
  /** src를 dest로 옮긴다(원자적 rename 기대). */
  move(src: string, dest: string): Promise<void>
  remove(path: string): Promise<void>
  /** 교체 후 앱이 정상 실행 가능한지. false면 rollback한다. */
  healthCheck(appPath: string): Promise<boolean>
}

export interface SwapInput {
  readonly fs: SwapFs
  /** 제자리 경로. 최종적으로 여기 새 앱이 있어야 한다. */
  readonly appPath: string
  /** 전개된 새 앱의 임시 경로. */
  readonly stagedPath: string
  /** 기존 앱을 잠시 옮겨 둘 백업 경로. */
  readonly backupPath: string
}

export type SwapResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'swap_failed' | 'health_failed'; readonly rolledBack: boolean }

export async function swapApp(input: SwapInput): Promise<SwapResult> {
  const { fs, appPath, stagedPath, backupPath } = input

  // 1. 기존 앱을 백업으로 옮긴다. 실패하면 아직 아무것도 안 건드렸다.
  try {
    await fs.move(appPath, backupPath)
  } catch {
    return { ok: false, reason: 'swap_failed', rolledBack: true }
  }

  // 2. 새 앱을 제자리로 옮긴다. 실패하면 백업을 제자리로 되돌린다 —
  //    여기서 안 되돌리면 제자리에 앱이 없는 상태로 남는다.
  try {
    await fs.move(stagedPath, appPath)
  } catch {
    const rolledBack = await restore(fs, backupPath, appPath)
    return { ok: false, reason: 'swap_failed', rolledBack }
  }

  // 3. 헬스체크. 실패하면 새 앱을 치우고 백업을 복원한다.
  let healthy = false
  try {
    healthy = await fs.healthCheck(appPath)
  } catch {
    healthy = false
  }
  if (!healthy) {
    await safeRemove(fs, appPath)
    const rolledBack = await restore(fs, backupPath, appPath)
    return { ok: false, reason: 'health_failed', rolledBack }
  }

  // 4. 성공. 백업을 지운다(실패해도 앱은 제자리에 있으니 성공으로 본다).
  await safeRemove(fs, backupPath)
  return { ok: true }
}

/** 백업을 제자리로 되돌린다. 되돌리기 성공 여부를 알려 준다. */
async function restore(fs: SwapFs, backupPath: string, appPath: string): Promise<boolean> {
  try {
    await fs.move(backupPath, appPath)
    return true
  } catch {
    return false
  }
}

async function safeRemove(fs: SwapFs, path: string): Promise<void> {
  try {
    await fs.remove(path)
  } catch {
    // 지우기 실패는 치명적이지 않다 — 제자리 앱 상태에 영향을 주지 않는다.
  }
}
