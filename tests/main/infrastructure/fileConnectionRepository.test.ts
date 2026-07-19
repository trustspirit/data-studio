import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileConnectionRepository } from '@main/infrastructure/FileConnectionRepository'
import { connectionConfigSchema } from '@shared/types/connection'
import type { ConnectionConfig } from '@shared/types/connection'

const PG: ConnectionConfig = {
  id: 'conn-1',
  name: 'Production',
  engine: 'postgres',
  host: 'db.example.com',
  port: 5432,
  database: 'ecommerce',
  username: 'app',
  tlsMode: 'verify-full',
  aiReadOnlyUsername: null,
  maskedColumnPatterns: ['email', 'phone'],
}

let dir = ''
let filePath = ''
const logger = { warn: vi.fn() }

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'datacon-conn-'))
  filePath = path.join(dir, 'connections.json')
  logger.warn.mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('FileConnectionRepository', () => {
  it('처음에는 빈 목록을 준다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)

    await expect(repo.list()).resolves.toEqual([])
  })

  it('저장한 커넥션을 다시 읽는다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    await repo.save(PG)

    await expect(repo.get('conn-1')).resolves.toEqual(PG)
  })

  it('새 인스턴스에서도 커넥션이 남아 있다', async () => {
    await new FileConnectionRepository(filePath, logger).save(PG)

    await expect(new FileConnectionRepository(filePath, logger).list()).resolves.toEqual([
      PG,
    ])
  })

  it('같은 id로 저장하면 교체한다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    await repo.save(PG)
    await repo.save({ ...PG, name: 'Staging' })

    const all = await repo.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.name).toBe('Staging')
  })

  it('없는 id는 null을 준다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)

    await expect(repo.get('nope')).resolves.toBeNull()
  })

  it('삭제하면 목록에서 빠진다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    await repo.save(PG)
    await repo.delete('conn-1')

    await expect(repo.list()).resolves.toEqual([])
  })

  it('없는 id 삭제는 조용히 성공한다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)

    await expect(repo.delete('nope')).resolves.toBeUndefined()
  })

  it('파일이 손상되면 경고하고 빈 상태로 시작한다', async () => {
    await writeFile(filePath, '{{{ broken', 'utf8')
    const repo = new FileConnectionRepository(filePath, logger)

    await expect(repo.list()).resolves.toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      'connections.corrupt_file',
      expect.objectContaining({ filePath }),
    )
  })

  it('스키마에 맞지 않는 항목은 건너뛰고 나머지를 살린다', async () => {
    await writeFile(
      filePath,
      JSON.stringify([PG, { id: 'bad', name: 'missing fields' }]),
      'utf8',
    )
    const repo = new FileConnectionRepository(filePath, logger)

    await expect(repo.list()).resolves.toEqual([PG])
    expect(logger.warn).toHaveBeenCalledWith(
      'connections.invalid_entry',
      expect.objectContaining({ index: 1 }),
    )
  })

  it('get()으로 받은 객체를 변경해도 이후 get() 결과에 영향을 주지 않는다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    await repo.save(PG)

    const first = await repo.get('conn-1')
    first!.name = 'Tampered'

    await expect(repo.get('conn-1')).resolves.toMatchObject({ name: 'Production' })
  })

  it('list()로 받은 객체를 변경해도 이후 list() 결과에 영향을 주지 않는다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    await repo.save(PG)

    const first = await repo.list()
    first[0]!.name = 'Tampered'

    const second = await repo.list()
    expect(second[0]?.name).toBe('Production')
  })

  it('반환된 설정의 maskedColumnPatterns 배열을 변경해도 캐시에 영향을 주지 않는다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    await repo.save(PG)

    const first = await repo.get('conn-1')
    first!.maskedColumnPatterns.push('ssn')

    const second = await repo.get('conn-1')
    expect(second?.maskedColumnPatterns).toEqual(['email', 'phone'])
  })

  it('get()으로 받은 설정을 변경한 뒤 무관한 설정을 save()해도 변경 사항이 디스크에 반영되지 않는다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    await repo.save(PG)

    const first = await repo.get('conn-1')
    first!.name = 'Tampered'
    first!.maskedColumnPatterns.push('ssn')

    const other: ConnectionConfig = { ...PG, id: 'conn-2', name: 'Staging' }
    await repo.save(other)

    const raw = await readFile(filePath, 'utf8')
    expect(raw).not.toContain('Tampered')
    expect(raw).not.toContain('ssn')
  })

  it('save()에 전달한 객체를 이후에 변경해도 get() 결과에 영향을 주지 않는다', async () => {
    const repo = new FileConnectionRepository(filePath, logger)
    const mutable: ConnectionConfig = { ...PG, maskedColumnPatterns: [...PG.maskedColumnPatterns] }

    await repo.save(mutable)
    mutable.name = 'Tampered'
    mutable.maskedColumnPatterns.push('ssn')

    await expect(repo.get('conn-1')).resolves.toMatchObject({
      name: 'Production',
      maskedColumnPatterns: ['email', 'phone'],
    })
  })

  describe('방어적 복사 — 스키마 전 필드', () => {
    // cloneConfig는 `{ ...config, maskedColumnPatterns: [...] }`로 손수 만든다.
    // 나중에 배열이나 객체 필드가 하나 추가되면 그 필드만 조용히 참조 공유가
    // 되고, 증상은 "설정을 안 바꿨는데 디스크의 값이 달라져 있다"는 알아채기
    // 어려운 형태로 나온다. 필드 목록을 손으로 적으면 다음 필드가 또 빠지므로
    // **스키마에서 키를 유도한다**.
    const keys = Object.keys(connectionConfigSchema.shape) as (keyof ConnectionConfig)[]

    it('스키마 키를 실제로 읽어온다', () => {
      // 키 목록이 비면 아래 테스트들이 아무것도 검사하지 않으면서 통과한다.
      expect(keys.length).toBeGreaterThan(5)
      expect(keys).toContain('maskedColumnPatterns')
    })

    it('get()이 돌려준 설정은 참조형 필드를 캐시와 공유하지 않는다', async () => {
      const repo = new FileConnectionRepository(filePath, logger)
      await repo.save(PG)

      const first = await repo.get('conn-1')
      const second = await repo.get('conn-1')

      for (const key of keys) {
        const a: unknown = first?.[key]
        const b: unknown = second?.[key]
        if (typeof a === 'object' && a !== null) {
          expect(a, `${key}가 두 호출 사이에 공유된다`).not.toBe(b)
        }
      }
    })

    it('save()에 넘긴 설정의 참조형 필드를 캐시가 공유하지 않는다', async () => {
      const repo = new FileConnectionRepository(filePath, logger)
      const input: ConnectionConfig = { ...PG, maskedColumnPatterns: ['email'] }
      await repo.save(input)

      const stored = await repo.get('conn-1')

      for (const key of keys) {
        const a: unknown = input[key]
        const b: unknown = stored?.[key]
        if (typeof a === 'object' && a !== null) {
          expect(a, `${key}가 호출자와 캐시 사이에 공유된다`).not.toBe(b)
        }
      }
    })

    it('모든 필드 값이 왕복해도 보존된다', async () => {
      // 복사가 필드를 떨어뜨리지 않는지도 같이 본다.
      const repo = new FileConnectionRepository(filePath, logger)
      await repo.save(PG)

      expect(await repo.get('conn-1')).toEqual(PG)
    })
  })
})
