/**
 * 자동 업데이트 포트. 상위 코드는 이 인터페이스에만 의존하고, electron-updater나
 * minisign 같은 구현 세부는 `infrastructure/update/SignedUpdater`에 격리한다.
 */

export type UpdateStatus =
  | { readonly kind: 'up_to_date' }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'rejected'; readonly reason: 'bad_signature' | 'downgrade' | 'malformed' }
  | { readonly kind: 'error' }

export type ApplyResult =
  | { readonly kind: 'applied'; readonly version: string }
  | { readonly kind: 'rejected'; readonly reason: 'bad_signature' | 'downgrade' | 'malformed' }
  /** 아티팩트 해시가 매니페스트와 다르다. */
  | { readonly kind: 'artifact_mismatch' }
  /** `/Applications` 쓰기 권한이 없다. 수동 설치를 안내한다(권한 상승 안 함). */
  | { readonly kind: 'manual_install_required' }
  /** 교체가 실패했다. rolledBack이면 기존 앱이 복원됐다. */
  | { readonly kind: 'swap_failed'; readonly rolledBack: boolean }
  | { readonly kind: 'error' }

export interface AppUpdater {
  checkForUpdate(): Promise<UpdateStatus>
  applyUpdate(): Promise<ApplyResult>
}
