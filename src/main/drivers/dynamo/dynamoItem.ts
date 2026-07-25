/**
 * `unmarshall`이 돌려준 아이템을 JSON 직렬화 가능한 값으로 정규화한다(순수).
 *
 * util-dynamodb의 unmarshall은 AttributeValue를 JS 값으로 바꾸지만, Binary는
 * Uint8Array로, Set은 native Set으로 남긴다 — 둘 다 JSON.stringify가 손실
 * 없이 담지 못한다. 여기서 Uint8Array→base64, Set→배열, bigint→문자열,
 * Date→ISO로 옮겨 `wire.json`이 안전하게 직렬화하게 한다.
 */
export function normalizeItem(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Set) return Array.from(value, normalizeItem)
  if (Array.isArray(value)) return value.map(normalizeItem)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalizeItem(v)
    return out
  }
  return value
}
