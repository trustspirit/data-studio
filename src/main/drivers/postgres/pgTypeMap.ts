import { wire, type WireValue } from '../../../shared/types/wire'

// pg 내장 타입 OID (안정적).
const BOOL = 16
const BYTEA = 17
const INT8 = 20
const INT2 = 21
const INT4 = 23
const TEXT = 25
const OID_TYPE = 26
const JSON_T = 114
const JSONB = 3802
const FLOAT4 = 700
const FLOAT8 = 701
const NUMERIC = 1700
const VARCHAR = 1043
const BPCHAR = 1042
const NAME = 19
const UUID = 2950
const TIMESTAMP = 1114
const TIMESTAMPTZ = 1184
const DATE = 1082
const TIME = 1083

/**
 * unknown 값을 안전하게 문자열로 옮긴다.
 *
 * `String(value)`는 `value: unknown`일 때 `@typescript-eslint/no-base-to-string`에
 * 걸린다 — 커스텀 toString이 없는 객체가 섞여 있으면 "[object Object]"로
 * 뭉개질 수 있어서다. 여기서는 pg가 실제로 줄 수 있는 원시 타입만 문자열화하고,
 * 그 외(이론상 도달하지 않아야 하는 값)는 JSON.stringify로 내용을 보존한다.
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
 * pg가 준 값(dataTypeID + 파싱된 JS 값)을 WireValue로 옮긴다.
 * pg 기본 파서를 쓰므로 int8/numeric은 문자열, bytea는 Buffer, json/배열은
 * 파싱된 객체, 시간류는 Date로 들어온다. 배열은 전용 WireValue가 없어 JSON으로 담는다.
 */
export function mapPgValue(dataTypeID: number, value: unknown): WireValue {
  if (value === null || value === undefined) return wire.null()

  // 배열은 OID(요소 타입)와 무관하게 JSON으로 — array WireValue가 없다.
  if (Array.isArray(value)) return wire.json(JSON.stringify(value))

  switch (dataTypeID) {
    case BOOL:
      return wire.bool(Boolean(value))
    case INT2:
    case INT4:
      return wire.int(Number(value))
    case INT8:
      return wire.bigint(stringify(value))
    case NUMERIC:
      return wire.decimal(stringify(value))
    case FLOAT4:
    case FLOAT8:
      return wire.float(Number(value))
    case TEXT:
    case VARCHAR:
    case BPCHAR:
    case NAME:
    case UUID:
      return wire.str(stringify(value))
    case BYTEA:
      return wire.bytes(value instanceof Uint8Array ? value : Uint8Array.from(value as ArrayLike<number>))
    case JSON_T:
    case JSONB:
      return wire.json(JSON.stringify(value))
    case TIMESTAMP:
    case TIMESTAMPTZ:
    case DATE:
    case TIME:
      return wire.date(stringify(value))
    case OID_TYPE:
      return wire.oid(stringify(value))
    default:
      return wire.unknown(stringify(value), `oid:${dataTypeID}`)
  }
}
