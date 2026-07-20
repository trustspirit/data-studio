import { describe, expect, it } from 'vitest'
import {
  parsePublicKey,
  parseSignature,
  verifyMinisign,
} from '@main/infrastructure/update/minisign'
import {
  makeKeypair,
  signContent,
  tamperKeyId,
  tamperSignatureByte,
} from './minisignFixture'

const CONTENT = Buffer.from('release artifact bytes')

describe('parsePublicKey', () => {
  it('algo/keyId/publicKey를 뽑는다', () => {
    const kp = makeKeypair()
    const parsed = parsePublicKey(kp.publicKeyText)

    expect(parsed.algo).toBe('Ed')
    expect(parsed.keyId.equals(kp.keyId)).toBe(true)
    expect(parsed.publicKey.equals(kp.rawPublicKey)).toBe(true)
  })

  it('42바이트가 아니면 throw', () => {
    expect(() => parsePublicKey('untrusted comment: x\nAAAA\n')).toThrow(/42 bytes/)
  })
})

describe('parseSignature', () => {
  it('필드를 뽑는다', () => {
    const kp = makeKeypair()
    const sig = signContent(kp, CONTENT, { trustedComment: 'version:1.2.3' })
    const parsed = parseSignature(sig)

    expect(parsed.signature).toHaveLength(64)
    expect(parsed.globalSignature).toHaveLength(64)
    expect(parsed.trustedComment).toBe('version:1.2.3')
  })

  it('trusted comment 접두사가 없으면 throw', () => {
    const kp = makeKeypair()
    // 3행(trusted comment)만 겨냥한다. 'untrusted comment:'가 'trusted comment:'를
    // 포함하므로 문자열 replace로는 1행이 먼저 걸린다.
    const lines = signContent(kp, CONTENT).split('\n')
    lines[2] = 'comment: timestamp:0'
    expect(() => parseSignature(lines.join('\n'))).toThrow(/trusted comment/)
  })
})

describe('verifyMinisign', () => {
  it('유효한 raw(Ed) 서명을 통과시킨다', () => {
    const kp = makeKeypair()
    const sig = signContent(kp, CONTENT)
    expect(verifyMinisign(CONTENT, sig, parsePublicKey(kp.publicKeyText))).toBe(true)
  })

  it('유효한 prehash(ED) 서명을 통과시킨다', () => {
    const kp = makeKeypair()
    const sig = signContent(kp, CONTENT, { prehash: true })
    expect(verifyMinisign(CONTENT, sig, parsePublicKey(kp.publicKeyText))).toBe(true)
  })

  it('content가 한 바이트라도 변조되면 거부한다', () => {
    const kp = makeKeypair()
    const sig = signContent(kp, CONTENT)
    const tampered = Buffer.concat([CONTENT.subarray(0, CONTENT.length - 1), Buffer.from([0x00])])
    expect(verifyMinisign(tampered, sig, parsePublicKey(kp.publicKeyText))).toBe(false)
  })

  it('다른 키로 서명한 서명을 거부한다 (위조)', () => {
    // 같은 keyId를 쓰지만 키는 다르다 — keyId 검사를 통과해도 서명 검증에서 걸린다.
    const sharedKeyId = Buffer.from('0102030405060708', 'hex')
    const pinned = makeKeypair(sharedKeyId)
    const forger = makeKeypair(sharedKeyId)
    const sig = signContent(forger, CONTENT)
    expect(verifyMinisign(CONTENT, sig, parsePublicKey(pinned.publicKeyText))).toBe(false)
  })

  it('keyId가 다르면 거부한다', () => {
    const kp = makeKeypair(Buffer.from('1111111111111111', 'hex'))
    const other = makeKeypair(Buffer.from('2222222222222222', 'hex'))
    const sig = signContent(kp, CONTENT)
    expect(verifyMinisign(CONTENT, sig, parsePublicKey(other.publicKeyText))).toBe(false)
  })

  it('서명은 유효하지만 keyId만 조작된 서명을 거부한다', () => {
    // content/global 서명은 진짜 키로 만들어 유효하다 — keyId 검사만이 이걸 잡는다.
    const kp = makeKeypair()
    const sig = tamperKeyId(signContent(kp, CONTENT))
    expect(verifyMinisign(CONTENT, sig, parsePublicKey(kp.publicKeyText))).toBe(false)
  })

  it('trusted comment가 변조되면 거부한다 (global sig)', () => {
    const kp = makeKeypair()
    const sig = signContent(kp, CONTENT, { trustedComment: 'version:1.2.3' })
    const tampered = sig.replace('version:1.2.3', 'version:9.9.9')
    expect(verifyMinisign(CONTENT, tampered, parsePublicKey(kp.publicKeyText))).toBe(false)
  })

  it('signature가 변조되면 거부한다', () => {
    const kp = makeKeypair()
    const sig = tamperSignatureByte(signContent(kp, CONTENT))
    expect(verifyMinisign(CONTENT, sig, parsePublicKey(kp.publicKeyText))).toBe(false)
  })

  it('형식이 깨진 서명을 거부한다 (throw하지 않고 false)', () => {
    const kp = makeKeypair()
    expect(verifyMinisign(CONTENT, 'garbage', parsePublicKey(kp.publicKeyText))).toBe(false)
  })
})
