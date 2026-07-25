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

/** 음수 연도(기원전)를 '0-44' 같은 쓰레기로 만들지 않도록 부호를 분리해 채운다. */
function pad(value: number, width: number): string {
  return value < 0
    ? `-${String(-value).padStart(width, '0')}`
    : String(value).padStart(width, '0')
}

/**
 * Date를 **로컬 성분 그대로** 문자열화한다. UTC 환산을 하지 않는 것이 핵심이다.
 *
 * pg는 오프셋이 없는 `timestamp`(1114)와 `date`(1082)를 로컬 타임존의 Date로
 * 파싱한다(postgres-date: 오프셋이 없으면 `new Date(y, m, d, ...)`). 여기에
 * `toISOString()`을 쓰면 그 로컬 시각이 UTC로 환산되면서 오프셋만큼 밀린다 —
 * Asia/Seoul(UTC+9)에서 `timestamp '2024-01-15 12:00:00'`은 03:00Z로,
 * `date '2024-01-15'`는 전날인 2024-01-14로 표시됐다. 게다가 그 값이 셀 편집의
 * PK/SET으로 되돌아가므로 왕복할 때마다 9시간씩 누적된다.
 *
 * 구분자는 'T'가 아니라 공백이다: PostgreSQL 자신의 ISO datestyle 출력과 같은
 * 모양이고, `timestamptz`가 남기는 `...Z`와 눈으로 구분돼 "오프셋이 없는 값"임이
 * 드러난다. 되쓸 때도 서버가 대상 컬럼 타입 규칙대로 그대로 파싱한다.
 *
 * 한계: 기원전 날짜는 pg가 음수 연도 Date로 주는데(BC 1년 = 0년), 여기서
 * '-0044-01-01'로 나가고 PostgreSQL이 원하는 '0045-01-01 BC'로는 되쓰이지 않는다.
 */
function formatLocalDate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`
}

function formatLocalTimestamp(d: Date): string {
  const ms = d.getMilliseconds()
  // 밀리초가 0이면 붙이지 않는다 — 서버가 소수 자릿수 없이 보낸 값을 그대로 되비춘다.
  const fraction = ms === 0 ? '' : `.${pad(ms, 3)}`
  return (
    `${formatLocalDate(d)} ` +
    `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}${fraction}`
  )
}

/**
 * 시간류 값을 문자열로. `infinity`/`-infinity`는 Date가 아니라 JS 숫자
 * `Infinity`로 온다(postgres-date가 그렇게 파싱한다). `String(Infinity)`는
 * 'Infinity'라는 JS 철자를 UI로 흘리므로 PostgreSQL 자신의 철자로 되돌린다 —
 * 그래야 화면 표기도 서버와 같고 되쓸 때도 그대로 파싱된다.
 */
function formatTemporal(value: unknown, format: (d: Date) => string): string {
  if (value === Infinity) return 'infinity'
  if (value === -Infinity) return '-infinity'
  return value instanceof Date ? format(value) : stringify(value)
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
      return wire.date(formatTemporal(value, formatLocalTimestamp))
    case DATE:
      // 날짜에는 시각 성분이 없다. 00:00:00을 지어내면 그 시각이 타임존 환산의
      // 먹잇감이 되고(이 버그의 출발점이다) 없던 정밀도를 있는 것처럼 보여준다.
      return wire.date(formatTemporal(value, formatLocalDate))
    case TIMESTAMPTZ:
      // 오프셋이 값에 실려 오는 유일한 시간 타입 — 실제 순간을 가리키므로
      // UTC 환산(toISOString)이 옳다. 여기만 기존 동작을 유지한다.
      return wire.date(formatTemporal(value, (d) => d.toISOString()))
    case TIME:
      // pg에 파서가 없어 문자열 그대로 온다 — 손댈 것이 없다.
      return wire.date(stringify(value))
    case OID_TYPE:
      return wire.oid(stringify(value))
    default:
      return wire.unknown(stringify(value), `oid:${dataTypeID}`)
  }
}
