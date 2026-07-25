import type { z } from 'zod'
import type { AiToolContext } from './AiToolContext'

/** LLM에 노출되는 tool 스펙(6b가 프로바이더 형식으로 변환한다). */
export interface AiToolSpec {
  readonly name: string
  readonly description: string
  /** JSON Schema(zod에서 파생). */
  readonly inputSchema: unknown
}

/** structuredClone 가능한 tool 결과. 6b가 LLM tool_result로 직렬화한다. */
export type ToolResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string }

/**
 * AI가 호출할 수 있는 tool 하나.
 *
 * `execute`는 이미 `inputSchema`로 검증된 입력을 받는다(검증은 ToolRegistry가
 * 한다). tool은 절대 관문을 우회하지 않는다 — 데이터 접근은 반드시
 * `ctx.executor.run(req, ctx.aiActor())`로 한다.
 */
export interface AiTool<I = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<I>
  execute(input: I, ctx: AiToolContext): Promise<ToolResult>
}
