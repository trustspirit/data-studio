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

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
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
      return TAG_OVERHEAD_BYTES + Buffer.byteLength(value.v, 'utf8')
    case 'bytes':
    case 'json':
      return TAG_OVERHEAD_BYTES + Buffer.byteLength(value.v, 'utf8')
    case 'unknown':
      return (
        TAG_OVERHEAD_BYTES +
        Buffer.byteLength(value.v, 'utf8') +
        Buffer.byteLength(value.note, 'utf8')
      )
  }
}
