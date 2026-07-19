import { describe, expect, it } from 'vitest'
import { estimateWireBytes, wire, type WireValue } from '@shared/types/wire'

describe('wire 생성자', () => {
  it('null을 태그로 표현한다', () => {
    expect(wire.null()).toEqual({ t: 'null' })
  })

  it('bigint를 문자열로 보존한다', () => {
    expect(wire.bigint(9007199254740993n)).toEqual({
      t: 'bigint',
      v: '9007199254740993',
    })
  })

  it('decimal을 문자열 그대로 보존한다 (정밀도 손실 방지)', () => {
    expect(wire.decimal('0.1000000000000000055511151231257827')).toEqual({
      t: 'decimal',
      v: '0.1000000000000000055511151231257827',
    })
  })

  it('Date를 ISO 8601 문자열로 표현한다', () => {
    expect(wire.date(new Date('2026-07-14T08:22:19.000Z'))).toEqual({
      t: 'date',
      v: '2026-07-14T08:22:19.000Z',
    })
  })

  it('bytes를 base64로 인코딩하고 절단 여부를 표시한다', () => {
    expect(wire.bytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toEqual({
      t: 'bytes',
      v: '3q2+7w==',
      enc: 'base64',
      truncated: false,
    })
  })

  it('bytes 절단을 명시적으로 표시한다', () => {
    const value = wire.bytes(new Uint8Array([1, 2]), { truncated: true })

    expect(value).toMatchObject({ t: 'bytes', truncated: true })
  })

  it('json은 직렬화된 문자열로 담는다', () => {
    expect(wire.json('{"a":1}')).toEqual({
      t: 'json',
      v: '{"a":1}',
      truncated: false,
    })
  })

  it('unknown은 값과 함께 이유를 남긴다', () => {
    expect(wire.unknown('<geometry>', 'unsupported pg type: geometry')).toEqual({
      t: 'unknown',
      v: '<geometry>',
      note: 'unsupported pg type: geometry',
    })
  })
})

describe('WireValue는 structuredClone으로 IPC를 건널 수 있다', () => {
  it('모든 변형이 구조적 복제를 견딘다', () => {
    const values: WireValue[] = [
      wire.null(),
      wire.bool(true),
      wire.int(42),
      wire.bigint(1n),
      wire.float(1.5),
      wire.decimal('1.10'),
      wire.str('hello'),
      wire.bytes(new Uint8Array([1])),
      wire.date(new Date(0)),
      wire.json('{}'),
      wire.oid('665f1a2b9c4e7d0012af33e1'),
      wire.unknown('x', 'why'),
    ]

    for (const value of values) {
      expect(structuredClone(value)).toEqual(value)
    }
  })

  it('복제된 값이 원본과 참조를 공유하지 않는다', () => {
    const original = wire.bytes(new Uint8Array([1, 2, 3]))
    const copy = structuredClone(original)

    expect(copy).not.toBe(original)
    expect(copy).toEqual(original)
  })
})

describe('estimateWireBytes', () => {
  it('null과 boolean은 고정 비용으로 센다', () => {
    expect(estimateWireBytes(wire.null())).toBeGreaterThan(0)
    expect(estimateWireBytes(wire.bool(true))).toBeGreaterThan(0)
  })

  it('문자열 길이에 비례해 커진다', () => {
    const short = estimateWireBytes(wire.str('a'))
    const long = estimateWireBytes(wire.str('a'.repeat(1000)))

    expect(long).toBeGreaterThan(short + 900)
  })

  it('멀티바이트 문자를 바이트 단위로 센다', () => {
    // '가'는 UTF-8로 3바이트다. 문자 수로 세면 이 검사가 실패한다.
    const ascii = estimateWireBytes(wire.str('aaa'))
    const hangul = estimateWireBytes(wire.str('가가가'))

    expect(hangul).toBeGreaterThan(ascii)
  })

  it('base64 bytes의 크기를 반영한다', () => {
    const small = estimateWireBytes(wire.bytes(new Uint8Array(10)))
    const large = estimateWireBytes(wire.bytes(new Uint8Array(10_000)))

    expect(large).toBeGreaterThan(small + 9000)
  })
})
