import { z } from 'zod'
import type { AiTool } from '../AiTool'

const input = z.object({})

export const listConnectionsTool: AiTool<z.infer<typeof input>> = {
  name: 'list_connections',
  description: 'List available data source connections (id, name, engine).',
  inputSchema: input,
  execute: async (_i, ctx) => {
    const conns = await ctx.connections.list()
    // 비밀·host·username·database 미노출 — AI는 대상 식별만 한다.
    return { ok: true, data: conns.map((c) => ({ id: c.id, name: c.name, engine: c.engine })) }
  },
}
