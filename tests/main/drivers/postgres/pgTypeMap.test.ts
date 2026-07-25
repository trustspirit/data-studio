import { describe, expect, it } from 'vitest'
import { mapPgValue } from '@main/drivers/postgres/pgTypeMap'

// pg 내장 타입 OID
const OID = { bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, text: 25, oid: 26,
  json: 114, jsonb: 3802, float4: 700, float8: 701, numeric: 1700, varchar: 1043,
  uuid: 2950, timestamp: 1114, timestamptz: 1184, date: 1082, time: 1083 } as const

describe('mapPgValue', () => {
  it('null은 wire.null', () => {
    expect(mapPgValue(OID.int4, null)).toEqual({ t: 'null' })
  })

  it('int4는 wire.int', () => {
    expect(mapPgValue(OID.int4, 42)).toEqual({ t: 'int', v: 42 })
  })

  it('int8은 wire.bigint (정밀도 보존 — number화 금지)', () => {
    // pg가 문자열로 준다. number로 바꾸면 9223372036854775807이 뭉개진다.
    expect(mapPgValue(OID.int8, '9223372036854775807')).toEqual({ t: 'bigint', v: '9223372036854775807' })
  })

  it('numeric은 wire.decimal (문자열 보존 — float화 금지)', () => {
    expect(mapPgValue(OID.numeric, '0.10')).toEqual({ t: 'decimal', v: '0.10' })
  })

  it('bool은 wire.bool', () => {
    expect(mapPgValue(OID.bool, true)).toEqual({ t: 'bool', v: true })
  })

  it('float8은 wire.float', () => {
    expect(mapPgValue(OID.float8, 1.5)).toEqual({ t: 'float', v: 1.5 })
  })

  it('text/varchar/uuid는 wire.str', () => {
    expect(mapPgValue(OID.text, 'hi')).toEqual({ t: 'str', v: 'hi' })
    expect(mapPgValue(OID.uuid, 'a-b')).toEqual({ t: 'str', v: 'a-b' })
  })

  it('bytea(Buffer)는 wire.bytes', () => {
    const result = mapPgValue(OID.bytea, Buffer.from([1, 2, 3]))
    expect(result).toMatchObject({ t: 'bytes', enc: 'base64' })
  })

  it('jsonb(파싱된 객체)는 wire.json으로 직렬화', () => {
    const result = mapPgValue(OID.jsonb, { a: 1 })
    expect(result).toEqual({ t: 'json', v: '{"a":1}', truncated: false })
  })

  it('배열은 wire.json으로 직렬화 (array WireValue가 없으므로)', () => {
    const result = mapPgValue(OID.int4, [1, 2, 3])
    // 값이 배열이면 OID와 무관하게 JSON으로 담는다.
    expect(result).toEqual({ t: 'json', v: '[1,2,3]', truncated: false })
  })

  it('oid 타입은 wire.oid', () => {
    expect(mapPgValue(OID.oid, 1234)).toEqual({ t: 'oid', v: '1234' })
  })

  it('미지의 OID는 wire.unknown으로 폴백', () => {
    const result = mapPgValue(999999, 'weird')
    expect(result).toMatchObject({ t: 'unknown', v: 'weird' })
  })
})

/**
 * 시간류 OID.
 *
 * 이 블록은 머신 타임존과 무관하게 결정적이다: pg가 오프셋 없는 타입에 하는 것과
 * 똑같이 `new Date(y, m, d, ...)`(로컬 성분)로 값을 만들고, 기대값도 그 로컬
 * 성분으로 쓴다. 두 쪽이 같은 타임존을 쓰므로 TZ를 고정할 필요가 없다 —
 * 반대로 `toISOString()`을 쓰던 옛 구현은 UTC를 제외한 모든 TZ에서 어긋난다.
 */
describe('mapPgValue: 시간류', () => {
  it('timestamp(1114)는 로컬 벽시계 값을 그대로 유지한다 (UTC 환산 금지)', () => {
    // pg는 `timestamp '2024-01-15 12:00:00'`을 로컬 12시 Date로 준다.
    // toISOString()을 태우면 Asia/Seoul에서 03:00Z로 9시간 밀렸다.
    const parsed = new Date(2024, 0, 15, 12, 0, 0)
    expect(mapPgValue(OID.timestamp, parsed)).toEqual({ t: 'date', v: '2024-01-15 12:00:00' })
  })

  it('timestamp의 밀리초는 0이 아닐 때만 붙는다', () => {
    expect(mapPgValue(OID.timestamp, new Date(2024, 0, 15, 12, 0, 0, 500))).toEqual({
      t: 'date',
      v: '2024-01-15 12:00:00.500',
    })
  })

  it('date(1082)는 날짜만 — 지어낸 시각이 없어야 하루가 밀리지 않는다', () => {
    // pg는 `date '2024-01-15'`를 로컬 자정 Date로 준다. 옛 구현은 이걸
    // 2024-01-14T15:00:00.000Z로 만들어 **전날**을 표시했다.
    const parsed = new Date(2024, 0, 15)
    expect(mapPgValue(OID.date, parsed)).toEqual({ t: 'date', v: '2024-01-15' })
  })

  it('timestamptz(1184)는 실제 순간이므로 UTC ISO 유지', () => {
    const d = new Date('2020-01-02T03:04:05.000Z')
    expect(mapPgValue(OID.timestamptz, d)).toEqual({ t: 'date', v: '2020-01-02T03:04:05.000Z' })
  })

  it('time(1083)은 pg가 문자열로 주므로 그대로 통과', () => {
    expect(mapPgValue(OID.time, '12:34:56')).toEqual({ t: 'date', v: '12:34:56' })
  })

  it('infinity/-infinity는 PostgreSQL 철자로 (pg는 JS 숫자 Infinity로 준다)', () => {
    // String(Infinity)는 'Infinity' — JS 철자가 UI로 새고 서버 표기와 어긋난다.
    expect(mapPgValue(OID.timestamp, Infinity)).toEqual({ t: 'date', v: 'infinity' })
    expect(mapPgValue(OID.timestamp, -Infinity)).toEqual({ t: 'date', v: '-infinity' })
    expect(mapPgValue(OID.date, Infinity)).toEqual({ t: 'date', v: 'infinity' })
    expect(mapPgValue(OID.timestamptz, -Infinity)).toEqual({ t: 'date', v: '-infinity' })
  })

  it('기원전 날짜(음수 연도)도 자릿수가 깨지지 않는다', () => {
    // pg는 BC를 음수 연도 Date로 준다. 부호를 떼지 않고 padStart하면 '0-44'가 된다.
    expect(mapPgValue(OID.date, new Date(-44, 2, 15))).toEqual({ t: 'date', v: '-0044-03-15' })
  })
})
