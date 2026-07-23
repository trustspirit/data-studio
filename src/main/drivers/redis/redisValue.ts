/**
 * Redis 값의 타입별 → JSON 직렬화 가능한 값 정규화(순수).
 *
 * 각 타입의 raw 표현(GET/LRANGE/SMEMBERS/HGETALL/ZRANGE WITHSCORES 결과)을
 * 하나의 JSON 값으로 통일해, 드라이버가 `value` json 컬럼 하나에 담을 수 있게 한다.
 */
export type RedisRawValue = string | null | readonly string[] | Record<string, string>

/** zrange WITHSCORES는 [member, score, member, score, ...] flat 배열을 준다. */
export function normalizeZset(flat: readonly string[]): { member: string; score: number }[] {
  const out: { member: string; score: number }[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ member: flat[i]!, score: Number(flat[i + 1]) })
  }
  return out
}

export function normalizeValue(type: string, raw: RedisRawValue): unknown {
  switch (type) {
    case 'string':
      return raw // string | null
    case 'list':
    case 'set':
      return raw // string[]
    case 'hash':
      return raw // Record<string,string>
    case 'zset':
      return normalizeZset((raw as readonly string[]) ?? [])
    default:
      // stream 및 알 수 없는 타입은 v1 미지원 — null로 표시한다.
      return null
  }
}
