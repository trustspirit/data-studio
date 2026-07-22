import { wire, type WireValue } from '@shared/types/wire'

/** mysql2 field type 코드(node-mysql 호환 상수). 실제 field.type 숫자와 일치한다. */
export const MYSQL_TYPE = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  JSON: 245,
  NEWDECIMAL: 246,
  BLOB: 252,
  VAR_STRING: 253,
  STRING: 254,
} as const

const INT_TYPES = new Set<number>([
  MYSQL_TYPE.TINY,
  MYSQL_TYPE.SHORT,
  MYSQL_TYPE.LONG,
  MYSQL_TYPE.INT24,
  MYSQL_TYPE.YEAR,
])
const FLOAT_TYPES = new Set<number>([MYSQL_TYPE.FLOAT, MYSQL_TYPE.DOUBLE])
const DECIMAL_TYPES = new Set<number>([MYSQL_TYPE.DECIMAL, MYSQL_TYPE.NEWDECIMAL])
const DATE_TYPES = new Set<number>([
  MYSQL_TYPE.TIMESTAMP,
  MYSQL_TYPE.DATE,
  MYSQL_TYPE.TIME,
  MYSQL_TYPE.DATETIME,
])
const STRING_TYPES = new Set<number>([MYSQL_TYPE.VAR_STRING, MYSQL_TYPE.STRING])

/**
 * unknown 값을 안전하게 문자열로 옮긴다.
 *
 * `String(value)`는 `value: unknown`일 때 `@typescript-eslint/no-base-to-string`에
 * 걸린다 — 커스텀 toString이 없는 객체가 섞여 있으면 "[object Object]"로
 * 뭉개질 수 있어서다(pgTypeMap.ts와 동일한 이유). mysql2가 실제로 줄 수 있는
 * 원시 타입만 문자열화하고, 그 외(이론상 도달하지 않아야 하는 값)는
 * JSON.stringify로 내용을 보존한다.
 */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value) ?? Object.prototype.toString.call(value)
}

/**
 * mysql2 필드 타입코드 + 런타임 값 → WireValue.
 * 커넥션이 dateStrings/bigNumberStrings로 열려 정밀도 위험 타입은 이미 문자열이다.
 * 객체 리터럴을 직접 만들지 않고 `wire.*` 생성자만 쓴다(태그 오타 컴파일 차단, bytes base64 정규화).
 */
export function mapMysqlValue(typeCode: number, value: unknown): WireValue {
  if (value === null || value === undefined) return wire.null()
  if (value instanceof Uint8Array) return wire.bytes(value)
  if (typeCode === MYSQL_TYPE.LONGLONG) return wire.bigint(stringify(value))
  if (DECIMAL_TYPES.has(typeCode)) return wire.decimal(stringify(value))
  if (INT_TYPES.has(typeCode)) return wire.int(Number(value))
  if (FLOAT_TYPES.has(typeCode)) return wire.float(Number(value))
  if (DATE_TYPES.has(typeCode)) return wire.date(stringify(value))
  if (typeCode === MYSQL_TYPE.JSON) {
    return wire.json(typeof value === 'string' ? value : JSON.stringify(value))
  }
  if (STRING_TYPES.has(typeCode) || typeCode === MYSQL_TYPE.BLOB) {
    if (typeof value === 'string') return wire.str(value)
  }
  if (typeof value === 'string') return wire.str(value)
  return wire.unknown(stringify(value), `mysqlType:${typeCode}`)
}
