/**
 * 업데이트 매니페스트. electron-updater의 `latest-mac.yml`에서 우리가 쓰는
 * 필드만 담는다.
 */
export interface UpdateArtifact {
  readonly name: string
  /** base64로 인코딩된 SHA-512. 다운로드한 아티팩트와 대조한다. */
  readonly sha512: string
  readonly size: number
}

export interface UpdateManifest {
  readonly version: string
  readonly files: readonly UpdateArtifact[]
}
