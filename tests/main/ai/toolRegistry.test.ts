import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '@main/ai/ToolRegistry'
import type { AiTool } from '@main/ai/AiTool'
import type { AiToolContext } from '@main/ai/AiToolContext'

const ctx = {} as AiToolContext

const echo: AiTool<{ msg: string }> = {
  name: 'echo',
  description: 'echoes',
  inputSchema: z.object({ msg: z.string() }),
  execute: (input) => Promise.resolve({ ok: true, data: input.msg }),
}

describe('ToolRegistry', () => {
  it('등록한 tool을 invoke한다', async () => {
    const reg = new ToolRegistry()
    reg.register(echo)
    expect(await reg.invoke('echo', { msg: 'hi' }, ctx)).toEqual({ ok: true, data: 'hi' })
  })

  it('모르는 tool은 ok:false', async () => {
    const reg = new ToolRegistry()
    const out = await reg.invoke('nope', {}, ctx)
    expect(out.ok).toBe(false)
  })

  it('입력 스키마 검증 실패는 ok:false', async () => {
    const reg = new ToolRegistry()
    reg.register(echo)
    const out = await reg.invoke('echo', { msg: 123 }, ctx)
    expect(out.ok).toBe(false)
  })

  it('execute 예외는 ok:false로 감싼다(원문 미노출)', async () => {
    const reg = new ToolRegistry()
    reg.register({ ...echo, name: 'boom', execute: () => Promise.reject(new Error('secret detail')) })
    const out = await reg.invoke('boom', { msg: 'x' }, ctx)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).not.toContain('secret detail')
  })

  it('specs가 등록된 tool 스펙을 준다', () => {
    const reg = new ToolRegistry()
    reg.register(echo)
    expect(reg.specs().map((s) => s.name)).toEqual(['echo'])
  })
})
