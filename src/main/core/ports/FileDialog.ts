/**
 * 파일 선택 다이얼로그 포트. main이 electron dialog로 구현하고, ipcRoutes가
 * `dialog:openFile` 핸들러에서 호출한다. 포트로 두어 핸들러를 electron 없이 테스트한다.
 */
export interface FileDialogPort {
  /** 파일 하나를 고른다. 취소 시 null. */
  openFile(): Promise<string | null>
}
