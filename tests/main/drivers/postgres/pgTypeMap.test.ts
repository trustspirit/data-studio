import { describe, expect, it } from 'vitest'
import { mapPgValue } from '@main/drivers/postgres/pgTypeMap'

// pg 내장 타입 OID
const OID = { bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, text: 25, oid: 26,
  json: 114, jsonb: 3802, float4: 700, float8: 701, numeric: 1700, varchar: 1043,
  uuid: 2950, timestamptz: 1184 } as const

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

  it('timestamptz(Date)는 wire.date ISO', () => {
    const d = new Date('2020-01-02T03:04:05.000Z')
    expect(mapPgValue(OID.timestamptz, d)).toEqual({ t: 'date', v: '2020-01-02T03:04:05.000Z' })
  })

  it('oid 타입은 wire.oid', () => {
    expect(mapPgValue(OID.oid, 1234)).toEqual({ t: 'oid', v: '1234' })
  })

  it('미지의 OID는 wire.unknown으로 폴백', () => {
    const result = mapPgValue(999999, 'weird')
    expect(result).toMatchObject({ t: 'unknown', v: 'weird' })
  })
})
