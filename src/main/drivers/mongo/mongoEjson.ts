import { BSON } from 'mongodb'
import { wire, type WireValue } from '@shared/types/wire'

/**
 * BSON 문서를 IPC로 무손실 전달하기 위한 canonical EJSON 문자열로 감싼다.
 *
 * `relaxed: false`(canonical) 모드를 반드시 써야 한다 — relaxed 모드는
 * `ObjectId`/`Decimal128`/`Date`/`Binary` 같은 타입 정보를 지운 "보기 좋은"
 * JSON을 내놓아 왕복(round-trip) 시 원래 BSON 타입이 사라진다. canonical
 * 모드는 `{ $oid }`/`{ $numberDecimal }`/`{ $date }`/`{ $binary }` 같은 래퍼로
 * 타입을 보존하고, `BSON.EJSON.parse`로 그대로 복원할 수 있다.
 */
export function docToWireJson(doc: unknown): WireValue {
  return wire.json(BSON.EJSON.stringify(doc, { relaxed: false }))
}

/** canonical EJSON 문자열을 원래 BSON 값(ObjectId/Decimal128/Date/Binary 등)으로 되돌린다. */
export function parseEjson(text: string): unknown {
  return BSON.EJSON.parse(text)
}
