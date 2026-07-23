import { describe, expect, it } from 'vitest'
import { ObjectId, Decimal128, Binary } from 'mongodb'
import { docToWireJson, parseEjson } from '@main/drivers/mongo/mongoEjson'

describe('mongoEjson', () => {
  it('docToWireJson은 wire.json으로 감싼 canonical EJSON 문자열을 준다', () => {
    const w = docToWireJson({ n: 1 })
    expect(w.t).toBe('json')
  })

  it('ObjectId/Decimal128/Date/Binary를 canonical(non-relaxed) EJSON으로 무손실 표현한다', () => {
    const oid = new ObjectId()
    const dec = Decimal128.fromString('12.34')
    const date = new Date('2020-01-01T00:00:00.000Z')
    const bin = new Binary(Buffer.from('hi'))
    const doc = { _id: oid, amount: dec, createdAt: date, blob: bin, n: 1, s: 'x' }

    const w = docToWireJson(doc)
    expect(w.t).toBe('json')
    if (w.t !== 'json') throw new Error('unreachable')

    const parsed = JSON.parse(w.v) as Record<string, unknown>
    // canonical mode: ObjectId → { $oid }, Decimal128 → { $numberDecimal },
    // Date → { $date: { $numberLong } }, Binary → { $binary }.
    expect((parsed._id as { $oid: string }).$oid).toBe(oid.toHexString())
    expect((parsed.amount as { $numberDecimal: string }).$numberDecimal).toBe('12.34')
    expect(parsed.createdAt).toHaveProperty('$date')
    expect(parsed.blob).toHaveProperty('$binary')
  })

  it('parseEjson으로 왕복하면 원래 BSON 타입/값이 복원된다', () => {
    const oid = new ObjectId()
    const dec = Decimal128.fromString('99.9')
    const date = new Date('2021-06-15T12:00:00.000Z')
    const bin = new Binary(Buffer.from('round-trip'))
    const doc = { _id: oid, amount: dec, createdAt: date, blob: bin }

    const w = docToWireJson(doc)
    if (w.t !== 'json') throw new Error('unreachable')
    const back = parseEjson(w.v) as {
      _id: ObjectId
      amount: Decimal128
      createdAt: Date
      blob: Binary
    }

    expect(back._id).toBeInstanceOf(ObjectId)
    expect(back._id.toHexString()).toBe(oid.toHexString())
    expect(back.amount).toBeInstanceOf(Decimal128)
    expect(back.amount.toString()).toBe('99.9')
    expect(back.createdAt).toBeInstanceOf(Date)
    expect(back.createdAt.toISOString()).toBe(date.toISOString())
    expect(Buffer.from(back.blob.buffer).toString()).toBe('round-trip')
  })
})
