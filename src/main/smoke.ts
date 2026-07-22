/**
 * 게이트된 SQLite 네이티브 로드 스모크.
 *
 * 패키지된 앱을 `--datacon-smoke-sqlite`로 띄우면, GUI를 올리기 전에 드라이버와
 * **동일한 `better-sqlite3` require 경로**로 :memory: DB를 열어 `SELECT 1`을 돌린다.
 * 성공하면 센티넬을 stdout에 찍고 0으로, 실패하면 에러를 찍고 1로 종료한다.
 * `scripts/verify-sqlite-native.cjs`가 이 출력/종료코드로 arm64 실빌드를 검증한다.
 *
 * 플래그가 없으면 즉시 false를 돌려 프로덕션 실행 경로에 아무 영향도 주지 않는다.
 * `exit`·`loadDatabase`는 주입 가능해 유닛 테스트가 프로세스를 죽이지 않고 성공·실패
 * 경로를 모두 검증한다(기본 `loadDatabase`는 드라이버와 동일한 실제 require).
 */
export const SMOKE_FLAG = '--datacon-smoke-sqlite'
export const SMOKE_SENTINEL = 'DATACON_SMOKE_SQLITE_OK'

interface SqliteRow {
  readonly ok: number
}
interface SqliteStatement {
  get(): SqliteRow | undefined
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  close(): void
}
type DatabaseCtor = new (filename: string) => SqliteDatabase

// 지연 require: 드라이버와 같은 모듈 해석을 타되, 플래그가 없을 땐 로드조차 하지 않는다.
function requireBetterSqlite3(): DatabaseCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('better-sqlite3') as DatabaseCtor
}

export function maybeRunSqliteSmoke(
  argv: readonly string[] = process.argv,
  exit: (code: number) => never = (code) => process.exit(code),
  loadDatabase: () => DatabaseCtor = requireBetterSqlite3,
): boolean {
  if (!argv.includes(SMOKE_FLAG)) return false

  try {
    const Database = loadDatabase()
    const db = new Database(':memory:')
    try {
      const row = db.prepare('SELECT 1 AS ok').get()
      if (row?.ok !== 1) throw new Error(`unexpected smoke result: ${JSON.stringify(row)}`)
    } finally {
      db.close()
    }
    console.log(SMOKE_SENTINEL)
    exit(0)
  } catch (e) {
    console.error('DATACON_SMOKE_SQLITE_FAIL', e instanceof Error ? e.message : String(e))
    exit(1)
  }
  return true
}
