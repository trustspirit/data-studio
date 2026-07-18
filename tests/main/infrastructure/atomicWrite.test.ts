import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { atomicWriteFile } from '@main/infrastructure/atomicWrite'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'datacon-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('atomicWriteFile', () => {
  it('파일을 쓴다', async () => {
    const file = path.join(dir, 'a.json')
    await atomicWriteFile(file, '{"x":1}')

    await expect(readFile(file, 'utf8')).resolves.toBe('{"x":1}')
  })

  it('소유자만 읽고 쓸 수 있는 권한으로 만든다', async () => {
    const file = path.join(dir, 'a.json')
    await atomicWriteFile(file, 'secret')

    const info = await stat(file)
    expect(info.mode & 0o777).toBe(0o600)
  })

  it('기존 파일을 덮어쓴다', async () => {
    const file = path.join(dir, 'a.json')
    await atomicWriteFile(file, 'first')
    await atomicWriteFile(file, 'second')

    await expect(readFile(file, 'utf8')).resolves.toBe('second')
  })

  it('임시 파일을 남기지 않는다', async () => {
    const file = path.join(dir, 'a.json')
    await atomicWriteFile(file, 'x')

    await expect(readdir(dir)).resolves.toEqual(['a.json'])
  })
})
