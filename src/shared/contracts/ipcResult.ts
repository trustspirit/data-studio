/**
 * IPC 경계를 건너는 실패 코드.
 *
 * 오류를 던져서 전달하지 않는 이유: Electron은 `ipcMain.handle`에서 던져진
 * 오류를 renderer로 넘길 때 name/message/stack만 직렬화한다. 커스텀 프로퍼티는
 * 사라진다 — 실측하면 renderer 쪽 수신값은 `code: undefined`다. 따라서 코드가
 * 타입으로 경계를 건너려면 반환값에 실려야 한다.
 */
export type IpcFailureCode = 'forbidden_sender' | 'invalid_input' | 'internal_error'

export type IpcResult<O> = { ok: true; value: O } | { ok: false; code: IpcFailureCode }
