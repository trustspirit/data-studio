import { describe, it, expect } from 'vitest'
import { registerIpcRoutes } from '@main/app/ipcRoutes'

describe('registerIpcRoutes dialog:openFile', () => {
  it('dialog:openFile은 fileDialog.openFile 결과를 돌려준다', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
    const register = ((ch: string, h: (i: unknown) => Promise<unknown>) => handlers.set(ch, h)) as never
    const services = { fileDialog: { openFile: () => Promise.resolve('/tmp/x.db') } } as never
    registerIpcRoutes(register, services)
    const result = await handlers.get('dialog:openFile')!(undefined)
    expect(result).toBe('/tmp/x.db')
  })

  it('취소 시 null', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
    const register = ((ch: string, h: (i: unknown) => Promise<unknown>) => handlers.set(ch, h)) as never
    const services = { fileDialog: { openFile: () => Promise.resolve(null) } } as never
    registerIpcRoutes(register, services)
    expect(await handlers.get('dialog:openFile')!(undefined)).toBeNull()
  })
})
