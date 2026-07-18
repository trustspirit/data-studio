import { readFile } from 'node:fs/promises'

export type JsonReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'corrupt' }

/**
 * JSON 파일을 읽어 형식까지 검증한다.
 *
 * "파일 없음"과 "파일 손상"을 구분해 돌려주는 것이 핵심이다 — 전자는 첫 실행의
 * 정상 상태이고 후자는 경고 대상이다. 로깅과 폴백 값은 호출자가 정한다.
 * 여기서 던지지 않으므로 손상된 파일이 앱 시작을 막지 못한다.
 */
export async function readJsonFile<T>(
  filePath: string,
  parse: (raw: unknown) => T,
): Promise<JsonReadResult<T>> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return { status: 'missing' }
  }

  try {
    return { status: 'ok', value: parse(JSON.parse(raw)) }
  } catch {
    return { status: 'corrupt' }
  }
}
