import { describe, expect, it } from 'vitest'
import { mapMysqlValue, MYSQL_TYPE } from '@main/drivers/mysql/mysqlTypeMap'

describe('mapMysqlValue', () => {
  it('null → wire.null', () => {
    expect(mapMysqlValue(MYSQL_TYPE.LONG, null)).toEqual({ t: 'null' })
  })

  it('정수(LONG) → wire.int', () => {
    expect(mapMysqlValue(MYSQL_TYPE.LONG, 42)).toEqual({ t: 'int', v: 42 })
  })

  it('BIGINT(LONGLONG)은 문자열로 → wire.bigint', () => {
    expect(mapMysqlValue(MYSQL_TYPE.LONGLONG, '9007199254740993')).toEqual({
      t: 'bigint',
      v: '9007199254740993',
    })
  })

  it('DECIMAL은 문자열로 → wire.decimal', () => {
    expect(mapMysqlValue(MYSQL_TYPE.NEWDECIMAL, '10.50')).toEqual({ t: 'decimal', v: '10.50' })
  })

  it('DOUBLE → wire.float', () => {
    expect(mapMysqlValue(MYSQL_TYPE.DOUBLE, 1.5)).toEqual({ t: 'float', v: 1.5 })
  })

  it('VAR_STRING → wire.str', () => {
    expect(mapMysqlValue(MYSQL_TYPE.VAR_STRING, 'hi')).toEqual({ t: 'str', v: 'hi' })
  })

  it('DATETIME(문자열) → wire.date', () => {
    expect(mapMysqlValue(MYSQL_TYPE.DATETIME, '2026-07-22 10:00:00')).toEqual({
      t: 'date',
      v: '2026-07-22 10:00:00',
    })
  })

  it('JSON → wire.json', () => {
    // wire.json은 truncated 플래그를 항상 포함한다 (src/shared/types/wire.ts 참조).
    expect(mapMysqlValue(MYSQL_TYPE.JSON, '{"a":1}')).toEqual({
      t: 'json',
      v: '{"a":1}',
      truncated: false,
    })
  })

  it('BLOB(Buffer) → wire.bytes (base64 정규화)', () => {
    const wv = mapMysqlValue(MYSQL_TYPE.BLOB, Buffer.from([1, 2, 3]))
    expect(wv.t).toBe('bytes')
  })
})
