import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'

/**
 * minisign wire 포맷 픽스처를 Node로 만든다. minisign CLI가 없으므로 정확한
 * 바이트 포맷으로 직접 만들되, 실제 minisign 도구와 상호운용되도록 스펙을 지킨다.
 *
 * - 공개키 2행: base64(algo(2) "Ed" + keyId(8) + pubkey(32))
 * - 서명 4행: untrusted comment / base64(algo(2) + keyId(8) + sig(64)) /
 *   `trusted comment: <text>` / base64(globalSig(64))
 * - algo "Ed" = raw 파일 서명, "ED" = BLAKE2b-512(파일) 서명
 * - globalSig = sign(sig(64) || utf8(trustedComment))
 */

export interface MinisignKeypair {
  readonly privateKey: KeyObject
  readonly publicKeyText: string
  readonly rawPublicKey: Buffer
  readonly keyId: Buffer
}

function rawEd25519PublicKey(publicKey: KeyObject): Buffer {
  const der = publicKey.export({ format: 'der', type: 'spki' })
  // SPKI 접두사(12바이트) 뒤 32바이트가 raw 공개키다.
  return der.subarray(der.length - 32)
}

export function makeKeypair(keyId = Buffer.from('0102030405060708', 'hex')): MinisignKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = rawEd25519PublicKey(publicKey)
  const body = Buffer.concat([Buffer.from('Ed', 'ascii'), keyId, raw])
  const publicKeyText = `untrusted comment: test key\n${body.toString('base64')}\n`
  return { privateKey, publicKeyText, rawPublicKey: raw, keyId }
}

export interface SignOptions {
  readonly prehash?: boolean
  readonly trustedComment?: string
}

export function signContent(
  keypair: MinisignKeypair,
  content: Buffer,
  options: SignOptions = {},
): string {
  const prehash = options.prehash ?? false
  const trustedComment = options.trustedComment ?? 'timestamp:0'
  const algo = prehash ? 'ED' : 'Ed'
  const message = prehash ? createHash('blake2b512').update(content).digest() : content

  const signature = sign(null, message, keypair.privateKey)
  const globalSignature = sign(
    null,
    Buffer.concat([signature, Buffer.from(trustedComment, 'utf8')]),
    keypair.privateKey,
  )

  const sigBody = Buffer.concat([Buffer.from(algo, 'ascii'), keypair.keyId, signature])

  return [
    'untrusted comment: signature',
    sigBody.toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64'),
    '',
  ].join('\n')
}

/** 서명 텍스트의 base64 서명 줄에서 한 바이트를 뒤집어 변조 픽스처를 만든다. */
export function tamperSignatureByte(sigText: string): string {
  const lines = sigText.split('\n')
  const decoded = Buffer.from(lines[1] ?? '', 'base64')
  const last = decoded.length - 1
  decoded[last] = (decoded[last] ?? 0) ^ 0xff
  lines[1] = decoded.toString('base64')
  return lines.join('\n')
}

/**
 * 진짜 키로 서명하되 서명 바이트 안의 keyId(오프셋 2..10)만 조작한다.
 * content/global 서명은 그대로 유효하므로, 이 픽스처를 거부하려면 keyId 검사가
 * 독립적으로 있어야 한다 — 없으면 서명은 통과한다.
 */
export function tamperKeyId(sigText: string): string {
  const lines = sigText.split('\n')
  const decoded = Buffer.from(lines[1] ?? '', 'base64')
  decoded[2] = (decoded[2] ?? 0) ^ 0xff
  lines[1] = decoded.toString('base64')
  return lines.join('\n')
}
