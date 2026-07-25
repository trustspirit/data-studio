import { z } from 'zod'
import type { AiTool, AiToolSpec, ToolResult } from './AiTool'
import type { AiToolContext } from './AiToolContext'

/**
 * name→tool 맵. 6b 오케스트레이터는 `invoke`만 호출한다(tool을 직접 부르지 않음).
 * invoke가 입력 스키마 검증과 예외 격리를 한 곳에서 처리한다.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AiTool<unknown>>()

  register<I>(tool: AiTool<I>): void {
    if (this.tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`)
    this.tools.set(tool.name, tool)
  }

  get(name: string): AiTool<unknown> | undefined {
    return this.tools.get(name)
  }

  specs(): AiToolSpec[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.inputSchema),
    }))
  }

  async invoke(name: string, rawInput: unknown, ctx: AiToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (tool === undefined) return { ok: false, error: `unknown tool: ${name}` }

    const parsed = tool.inputSchema.safeParse(rawInput)
    if (!parsed.success) return { ok: false, error: `invalid input for ${name}` }

    try {
      return await tool.execute(parsed.data, ctx)
    } catch {
      // 원문 예외 메시지는 LLM/사용자에게 노출하지 않는다(엔진 값 유출 방지).
      return { ok: false, error: `tool ${name} failed` }
    }
  }
}
