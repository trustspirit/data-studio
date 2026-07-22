import { wire, type WireValue } from '../../../shared/types/wire'

/**
 * better-sqlite3가 돌려주는 JS 값을 WireValue로 정규화한다.
 * better-sqlite3 값 종류: null / number / bigint / string / Buffer(=Uint8Array).
 * wire.* 생성자를 써 태그 오타를 컴파일에서 잡고, bytes는 base64로 정규화한다.
 */
export function sqliteValueMap(value: unknown): WireValue {
  if (value === null || value === undefined) return wire.null()
  if (typeof value === 'number') return Number.isInteger(value) ? wire.int(value) : wire.float(value)
  if (typeof value === 'bigint') return wire.bigint(value)
  if (typeof value === 'string') return wire.str(value)
  if (value instanceof Uint8Array) return wire.bytes(value)
  // 도달 불가 — better-sqlite3는 위 5종만 돌려준다. 방어적으로 JSON 직렬화(실패 시 노트만).
  const note = 'unmapped sqlite value'
  try {
    return wire.unknown(JSON.stringify(value) ?? note, note)
  } catch {
    return wire.unknown(note, note)
  }
}
