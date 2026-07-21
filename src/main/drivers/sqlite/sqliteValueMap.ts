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
  return wire.unknown(String(value), 'unmapped sqlite value')
}
