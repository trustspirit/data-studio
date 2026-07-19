import { Buffer } from 'node:buffer'
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

// wire.ts는 src/shared/에 있어 renderer 번들에도 들어간다 (sandbox: true,
// nodeIntegration: false) — `Buffer`를 쓸 수 없다. 아래 테스트는 두 가지를
// 증명한다: (1) 새 base64/UTF-8 바이트 길이 구현이 Node `Buffer` 구현과
// 바이트 단위로 동일한 출력을 낸다는 것, (2) 큰 입력에서 스택을 넘치지
// 않는다는 것. 기대값은 마이그레이션 전 `Buffer.from(bytes).toString('base64')`
// / `Buffer.byteLength(s, 'utf8')` 로 미리 캡처해 리터럴로 박아 뒀다 —
// `node -e` 스크립트로 산출.
// wire.bytes()의 반환 타입은 WireValue 유니온이라 `.v`가 바로 좁혀지지 않는다.
// 태그를 확인해 좁힌 뒤 꺼낸다 — 실패하면 wire.bytes 자체가 깨진 것이다.
function base64Of(bytes: Uint8Array): string {
  const value = wire.bytes(bytes)
  if (value.t !== 'bytes') {
    throw new Error('unreachable: wire.bytes always returns t: "bytes"')
  }
  return value.v
}

describe('toBase64는 Buffer.from(bytes).toString(base64)와 바이트 단위로 동일하다', () => {
  it('빈 배열은 빈 문자열이다', () => {
    expect(base64Of(new Uint8Array([]))).toBe('')
  })

  it('1바이트 나머지는 == 패딩이 붙는다', () => {
    // Buffer.from([0x41]).toString('base64') === 'QQ=='
    expect(base64Of(new Uint8Array([0x41]))).toBe('QQ==')
  })

  it('2바이트 나머지는 = 패딩이 붙는다', () => {
    // Buffer.from([0x41, 0x42]).toString('base64') === 'QUI='
    expect(base64Of(new Uint8Array([0x41, 0x42]))).toBe('QUI=')
  })

  it('3바이트는 패딩 없이 꽉 찬 4글자 그룹이다', () => {
    // Buffer.from([0x41, 0x42, 0x43]).toString('base64') === 'QUJD'
    expect(base64Of(new Uint8Array([0x41, 0x42, 0x43]))).toBe('QUJD')
  })

  it('임의 바이트 열도 Buffer와 일치한다', () => {
    // Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64') === '3q2+7w=='
    expect(base64Of(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('3q2+7w==')
  })

  it('100KB를 넘는 입력에서도 콜 스택을 넘치지 않고 Buffer와 동일한 출력을 낸다', () => {
    // btoa(String.fromCharCode(...bytes))는 이 크기에서 스프레드 연산자가
    // 콜 스택을 넘친다. mulberry32로 만든 결정적 의사난수 바이트로, 세 가지
    // 나머지(len % 3 === 0/1/2)를 모두 지나가도록 길이를 고른다.
    let seed = 42
    function next(): number {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    const length = 150_001 // 150KB, 3으로 나누어떨어지지 않음 (나머지 1)
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(next() * 256)
    }

    const expected = Buffer.from(bytes).toString('base64')

    expect(() => wire.bytes(bytes)).not.toThrow()
    expect(base64Of(bytes)).toBe(expected)
  })
})

describe('estimateWireBytes의 UTF-8 바이트 계산은 Buffer.byteLength(s, utf8)와 동일하다', () => {
  // wire.ts는 고정 오버헤드 상수를 export하지 않는다 — 대신 빈 문자열(0바이트)의
  // 결과를 기준선으로 삼아 문자열 부분만 비교한다.
  const overhead = estimateWireBytes(wire.str(''))

  it('빈 문자열은 0바이트다', () => {
    // Buffer.byteLength('', 'utf8') === 0
    expect(estimateWireBytes(wire.str(''))).toBe(overhead + 0)
  })

  it('ASCII는 문자당 1바이트다', () => {
    // Buffer.byteLength('abc', 'utf8') === 3
    expect(estimateWireBytes(wire.str('abc'))).toBe(overhead + 3)
  })

  it('2바이트 문자(é)를 포함하면 Buffer와 동일하다', () => {
    // Buffer.byteLength('café', 'utf8') === 5
    expect(estimateWireBytes(wire.str('café'))).toBe(overhead + 5)
  })

  it('3바이트 문자(한글)만 있을 때도 Buffer와 동일하다', () => {
    // Buffer.byteLength('가가가', 'utf8') === 9
    expect(estimateWireBytes(wire.str('가가가'))).toBe(overhead + 9)
  })

  it('ASCII/2바이트/3바이트가 섞여도 Buffer와 동일하다', () => {
    // Buffer.byteLength('a한é', 'utf8') === 6 (1 + 3 + 2)
    expect(estimateWireBytes(wire.str('a한é'))).toBe(overhead + 6)
  })

  it('BMP 밖 이모지(서로게이트 쌍)는 4바이트로, Buffer와 동일하다', () => {
    // Buffer.byteLength('😀', 'utf8') === 4
    expect(estimateWireBytes(wire.str('😀'))).toBe(overhead + 4)
  })

  it('서로게이트 쌍이 문자열 중간에 섞여도 인덱스를 올바르게 건너뛴다', () => {
    // Buffer.byteLength('a😀b', 'utf8') === 6 (1 + 4 + 1)
    expect(estimateWireBytes(wire.str('a😀b'))).toBe(overhead + 6)
  })
})
