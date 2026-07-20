import { createHash, createPublicKey, verify } from 'node:crypto'

/**
 * minisign 서명 검증. Node 네이티브 Ed25519 + BLAKE2b-512로 구현한다 —
 * 새 런타임 의존성 없이 minisign wire 포맷을 그대로 지킨다.
 *
 * 서명 없는 자동 업데이트는 릴리스 채널이 오염되면 임의 코드 실행 경로가 된다.
 * 이 모듈이 그것을 막는 신뢰 뿌리다.
 */

export interface MinisignPublicKey {
  readonly algo: string
  readonly keyId: Buffer
  readonly publicKey: Buffer
}

export interface MinisignSignature {
  readonly algo: string
  readonly keyId: Buffer
  readonly signature: Buffer
  readonly trustedComment: string
  readonly globalSignature: Buffer
}

/** Ed25519 raw 32바이트 공개키를 SPKI DER로 감싸는 고정 접두사. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** 공개키 텍스트 2행에서 algo(2)+keyId(8)+pubkey(32) = 42바이트를 뽑는다. */
export function parsePublicKey(text: string): MinisignPublicKey {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  const b64 = lines[lines.length - 1]
  if (b64 === undefined) throw new Error('minisign public key: empty')

  const body = Buffer.from(b64.trim(), 'base64')
  if (body.length !== 42) {
    throw new Error(`minisign public key: expected 42 bytes, got ${body.length}`)
  }
  return {
    algo: body.subarray(0, 2).toString('ascii'),
    keyId: body.subarray(2, 10),
    publicKey: body.subarray(10, 42),
  }
}

/**
 * 서명 텍스트 4행에서 필드를 뽑는다.
 * 2행: base64(algo(2)+keyId(8)+sig(64)=74). 3행: `trusted comment: <text>`.
 * 4행: base64(globalSig(64)).
 */
export function parseSignature(text: string): MinisignSignature {
  const lines = text.split('\n')
  const sigLine = lines[1]
  const commentLine = lines[2]
  const globalLine = lines[3]
  if (sigLine === undefined || commentLine === undefined || globalLine === undefined) {
    throw new Error('minisign signature: expected 4 lines')
  }

  const sigBody = Buffer.from(sigLine.trim(), 'base64')
  if (sigBody.length !== 74) {
    throw new Error(`minisign signature: expected 74 bytes, got ${sigBody.length}`)
  }

  const prefix = 'trusted comment: '
  if (!commentLine.startsWith(prefix)) {
    throw new Error('minisign signature: missing trusted comment')
  }

  const globalSignature = Buffer.from(globalLine.trim(), 'base64')
  if (globalSignature.length !== 64) {
    throw new Error(`minisign signature: global signature must be 64 bytes`)
  }

  return {
    algo: sigBody.subarray(0, 2).toString('ascii'),
    keyId: sigBody.subarray(2, 10),
    signature: sigBody.subarray(10, 74),
    trustedComment: commentLine.slice(prefix.length),
    globalSignature,
  }
}

function toKeyObject(publicKey: Buffer) {
  const der = Buffer.concat([ED25519_SPKI_PREFIX, publicKey])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

/**
 * 서명을 검증한다. **아래를 모두 통과해야 true.** 하나라도 어긋나면 false다.
 *
 * 1. keyId 일치 — 다른 키로 서명됐으면 거부.
 * 2. `ED`면 BLAKE2b-512(content), `Ed`면 content에 서명 검증.
 * 3. global signature 검증 — trusted comment를 서명에 묶는다. comment가 변조되면
 *    여기서 걸린다.
 */
export function verifyMinisign(
  content: Buffer,
  sigText: string,
  pubKey: MinisignPublicKey,
): boolean {
  let sig: MinisignSignature
  try {
    sig = parseSignature(sigText)
  } catch {
    return false
  }

  if (!sig.keyId.equals(pubKey.keyId)) return false

  const key = toKeyObject(pubKey.publicKey)

  const message = sig.algo === 'ED' ? createHash('blake2b512').update(content).digest() : content
  if (!verify(null, message, key, sig.signature)) return false

  const globalMessage = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')])
  if (!verify(null, globalMessage, key, sig.globalSignature)) return false

  return true
}
