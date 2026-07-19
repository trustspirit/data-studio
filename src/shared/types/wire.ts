/**
 * IPC 경계를 건너는 셀 값의 표현.
 *
 * 왜 태그 유니온인가: structuredClone(Electron IPC가 쓰는 알고리즘)은 Date와
 * BigInt는 처리하지만 PostgreSQL `numeric`, MongoDB `Decimal128`/`ObjectId`,
 * 드라이버가 만든 클래스 인스턴스는 손실하거나 던진다. 값의 종류를 태그로
 * 명시하고 내용은 원시 타입으로만 담으면, 어떤 엔진의 값이든 손실 없이 건널 수
 * 있고 renderer의 셀 렌더러가 `t`만 보고 표현을 고를 수 있다.
 *
 * 정밀도가 중요한 타입(`bigint`, `decimal`)은 number가 아니라 **문자열**로
 * 보존한다. number로 담는 순간 IEEE 754 이중 정밀도로 뭉개진다.
 */
export type WireValue =
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'int'; v: number }
  | { t: 'bigint'; v: string }
  | { t: 'float'; v: number }
  | { t: 'decimal'; v: string }
  | { t: 'str'; v: string }
  | { t: 'bytes'; v: string; enc: 'base64'; truncated: boolean }
  | { t: 'date'; v: string }
  | { t: 'json'; v: string; truncated: boolean }
  | { t: 'oid'; v: string }
  | { t: 'unknown'; v: string; note: string }

export interface TruncatableOptions {
  readonly truncated?: boolean
}

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * bytes를 base64 문자열로 인코딩한다.
 *
 * `Buffer`는 Node 전용이라 renderer 번들에서 `ReferenceError`로 죽는다.
 * `btoa(String.fromCharCode(...bytes))`도 대안이 아니다 — 스프레드 연산자로
 * 큰 `Uint8Array`를 함수 인자로 펼치면 실제 blob 크기에서 콜 스택을 넘친다.
 * 그래서 3바이트씩 묶어 직접 인코딩한다.
 */
function toBase64(bytes: Uint8Array): string {
  let result = ''
  const len = bytes.length
  const remainder = len % 3
  const mainLength = len - remainder

  for (let i = 0; i < mainLength; i += 3) {
    const b0 = bytes[i] as number
    const b1 = bytes[i + 1] as number
    const b2 = bytes[i + 2] as number
    const chunk = (b0 << 16) | (b1 << 8) | b2

    result +=
      BASE64_CHARS.charAt((chunk >> 18) & 0x3f) +
      BASE64_CHARS.charAt((chunk >> 12) & 0x3f) +
      BASE64_CHARS.charAt((chunk >> 6) & 0x3f) +
      BASE64_CHARS.charAt(chunk & 0x3f)
  }

  if (remainder === 1) {
    const b0 = bytes[mainLength] as number
    const chunk = b0 << 16

    result +=
      BASE64_CHARS.charAt((chunk >> 18) & 0x3f) + BASE64_CHARS.charAt((chunk >> 12) & 0x3f) + '=='
  } else if (remainder === 2) {
    const b0 = bytes[mainLength] as number
    const b1 = bytes[mainLength + 1] as number
    const chunk = (b0 << 16) | (b1 << 8)

    result +=
      BASE64_CHARS.charAt((chunk >> 18) & 0x3f) +
      BASE64_CHARS.charAt((chunk >> 12) & 0x3f) +
      BASE64_CHARS.charAt((chunk >> 6) & 0x3f) +
      '='
  }

  return result
}

/**
 * 문자열의 UTF-8 바이트 길이를 할당 없이 센다.
 *
 * `new TextEncoder().encode(s).length`는 호출마다 `Uint8Array`를 새로 만든다.
 * `estimateWireBytes`는 셀마다 호출되므로 1000행 x 20열 페이지 하나에서
 * 2만 개의 버림 배열이 생긴다. 대신 코드 유닛을 순회하며 범위별로 바이트 수를
 * 더하고, 서로게이트 쌍은 4바이트로 세면서 인덱스를 한 칸 더 건너뛴다.
 * 서로게이트가 짝을 이루지 못하면 U+FFFD로 치환됐을 때의 크기인 3바이트로
 * 센다 — `TextEncoder`/`Buffer`도 짝 없는 서로게이트를 그렇게 다룬다.
 */
function utf8ByteLength(input: string): number {
  let bytes = 0
  const len = input.length

  for (let i = 0; i < len; i++) {
    const code = input.charCodeAt(i)

    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < len) {
      const next = input.charCodeAt(i + 1)

      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }

  return bytes
}

/**
 * WireValue 생성자. 드라이버가 엔진 고유 값을 여기로 통과시켜 정규화한다.
 * 객체 리터럴을 직접 쓰지 않고 이 함수들을 쓰면 태그 오타가 컴파일 단계에서 잡힌다.
 */
export const wire = {
  null: (): WireValue => ({ t: 'null' }),
  bool: (v: boolean): WireValue => ({ t: 'bool', v }),
  int: (v: number): WireValue => ({ t: 'int', v }),
  bigint: (v: bigint | string): WireValue => ({ t: 'bigint', v: String(v) }),
  float: (v: number): WireValue => ({ t: 'float', v }),
  decimal: (v: string): WireValue => ({ t: 'decimal', v }),
  str: (v: string): WireValue => ({ t: 'str', v }),
  bytes: (v: Uint8Array, opts: TruncatableOptions = {}): WireValue => ({
    t: 'bytes',
    v: toBase64(v),
    enc: 'base64',
    truncated: opts.truncated ?? false,
  }),
  date: (v: Date | string): WireValue => ({
    t: 'date',
    v: typeof v === 'string' ? v : v.toISOString(),
  }),
  json: (v: string, opts: TruncatableOptions = {}): WireValue => ({
    t: 'json',
    v,
    truncated: opts.truncated ?? false,
  }),
  oid: (v: string): WireValue => ({ t: 'oid', v }),
  unknown: (v: string, note: string): WireValue => ({ t: 'unknown', v, note }),
} as const

/** 태그와 프로퍼티 이름이 차지하는 대략적인 고정 비용. */
const TAG_OVERHEAD_BYTES = 16

/**
 * 페이지 byte 상한을 적용하기 위한 근사치.
 *
 * 정확한 직렬화 크기가 아니라 **상한 판정용**이다. 정확도보다 저렴함이 중요하다 —
 * 행마다 호출되므로 여기서 JSON.stringify를 하면 페이지네이션이 자기 비용에
 * 잡아먹힌다. 문자열은 문자 수가 아니라 UTF-8 바이트로 센다.
 */
export function estimateWireBytes(value: WireValue): number {
  switch (value.t) {
    case 'null':
      return TAG_OVERHEAD_BYTES
    case 'bool':
    case 'int':
    case 'float':
      return TAG_OVERHEAD_BYTES + 8
    case 'bigint':
    case 'decimal':
    case 'str':
    case 'date':
    case 'oid':
      return TAG_OVERHEAD_BYTES + utf8ByteLength(value.v)
    case 'bytes':
    case 'json':
      return TAG_OVERHEAD_BYTES + utf8ByteLength(value.v)
    case 'unknown':
      return TAG_OVERHEAD_BYTES + utf8ByteLength(value.v) + utf8ByteLength(value.note)
  }
}
