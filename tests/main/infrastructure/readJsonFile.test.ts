import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readJsonFile } from '@main/infrastructure/readJsonFile'

const asArray = (raw: unknown): unknown[] => {
  if (!Array.isArray(raw)) throw new Error('not an array')
  return raw
}

let dir = ''
let filePath = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'datacon-json-'))
  filePath = path.join(dir, 'data.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readJsonFile', () => {
  it('없는 파일은 missing으로 보고한다', async () => {
    await expect(readJsonFile(filePath, asArray)).resolves.toEqual({ status: 'missing' })
  })

  it('올바른 JSON은 파싱해서 돌려준다', async () => {
    await writeFile(filePath, '[1,2,3]', 'utf8')

    await expect(readJsonFile(filePath, asArray)).resolves.toEqual({
      status: 'ok',
      value: [1, 2, 3],
    })
  })

  it('JSON 문법이 깨지면 corrupt로 보고한다', async () => {
    await writeFile(filePath, '{{{ not json', 'utf8')

    await expect(readJsonFile(filePath, asArray)).resolves.toEqual({ status: 'corrupt' })
  })

  it('parse가 던지면 corrupt로 보고한다', async () => {
    await writeFile(filePath, '{"a":1}', 'utf8')

    await expect(readJsonFile(filePath, asArray)).resolves.toEqual({ status: 'corrupt' })
  })

  it('missing과 corrupt를 구분한다', async () => {
    const missing = await readJsonFile(filePath, asArray)
    await writeFile(filePath, 'broken', 'utf8')
    const corrupt = await readJsonFile(filePath, asArray)

    expect(missing.status).toBe('missing')
    expect(corrupt.status).toBe('corrupt')
  })
})
