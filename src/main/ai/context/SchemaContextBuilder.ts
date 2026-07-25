export interface SchemaColumn {
  readonly name: string
  readonly type: string
}
export interface SchemaTable {
  readonly schema: string
  readonly name: string
  readonly columns: readonly SchemaColumn[]
}
export interface SchemaConnection {
  readonly id: string
  readonly name: string
  readonly engine: string
  readonly tables: readonly SchemaTable[]
}
export interface SchemaContextInput {
  readonly connections: readonly SchemaConnection[]
}

/**
 * 스키마를 **결정적 안정 문자열**로 만든다 — 대화 중 변하지 않는 프롬프트 캐시
 * 프리픽스로 쓰므로, 타임스탬프·UUID 등 매 요청 변하는 값을 절대 섞지 않는다
 * (섞으면 캐시 프리픽스가 통째로 무효화된다). 커넥션·테이블·컬럼을 이름으로
 * 결정적 정렬해 입력 순서에 무관하게 같은 출력을 낸다.
 */
export function formatSchema(input: SchemaContextInput): string {
  const conns = [...input.connections].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const lines: string[] = []
  for (const conn of conns) {
    lines.push(`# connection ${conn.name} (${conn.engine})`)
    const tables = [...conn.tables].sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name))
    for (const table of tables) {
      lines.push(`## ${table.schema}.${table.name}`)
      const columns = [...table.columns].sort((a, b) => a.name.localeCompare(b.name))
      for (const col of columns) lines.push(`- ${col.name} ${col.type}`)
    }
  }
  return lines.join('\n')
}
