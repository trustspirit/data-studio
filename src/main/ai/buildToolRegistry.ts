import { ToolRegistry } from './ToolRegistry'
import { listConnectionsTool } from './tools/listConnections'
import { getSchemaTool } from './tools/getSchema'
import { getTableStatsTool } from './tools/getTableStats'
import { runReadQueryTool } from './tools/runReadQuery'
import { explainQueryTool } from './tools/explainQuery'
import { explainAnalyzeTool } from './tools/explainAnalyze'
import { proposeWriteTool } from './tools/proposeWrite'

/** 6a의 7개 tool을 등록한 레지스트리. 오케스트레이터가 specs()/invoke를 쓴다. */
export function buildToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  reg.register(listConnectionsTool)
  reg.register(getSchemaTool)
  reg.register(getTableStatsTool)
  reg.register(runReadQueryTool)
  reg.register(explainQueryTool)
  reg.register(explainAnalyzeTool)
  reg.register(proposeWriteTool)
  return reg
}
