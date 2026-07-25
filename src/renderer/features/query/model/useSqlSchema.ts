import { useEffect, useMemo, useState } from 'react'
import type { SQLNamespace } from '@codemirror/lang-sql'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

/** 자동완성이 뒤지는 스키마 수 상한 — 거대 DB에서 요청 폭주를 막는다. */
const MAX_SCHEMAS = 10

export interface SqlSchemaCompletion {
  /** CodeMirror lang-sql의 schema 네임스페이스: { 스키마: { 테이블: [] } } */
  readonly namespace: SQLNamespace
  /** 접두어 없는 테이블 자동완성에 쓸 기본 스키마. */
  readonly defaultSchema: string | undefined
}

const EMPTY: SqlSchemaCompletion = { namespace: {}, defaultSchema: undefined }

/**
 * 쿼리 자동완성용 스키마/테이블 목록을 조용히 수집한다. 자동완성은
 * best-effort라 실패해도 에러를 띄우지 않는다 — 키워드 완성은 그대로 동작한다.
 * `enabled`가 false면 아무 요청도 보내지 않는다.
 */
export function useSqlSchema(
  gateway: OperationGateway,
  connectionId: string,
  enabled: boolean,
): SqlSchemaCompletion {
  const [tablesBySchema, setTablesBySchema] = useState<Readonly<Record<string, readonly string[]>>>({})

  useEffect(() => {
    setTablesBySchema({})
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const out = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'schema', op: 'listSchemas' },
        })
        if (cancelled || !out.ok || out.payload.kind !== 'schemas') return
        const names = out.payload.schemas.slice(0, MAX_SCHEMAS).map((s) => s.name)
        const results = await Promise.all(
          names.map(async (schema) => {
            const tables = await gateway.run({
              requestId: crypto.randomUUID(),
              connectionId,
              operation: { kind: 'schema', op: 'listTables', schema },
            })
            const list =
              tables.ok && tables.payload.kind === 'tables'
                ? tables.payload.tables.map((tbl) => tbl.name)
                : []
            return [schema, list] as const
          }),
        )
        if (!cancelled) setTablesBySchema(Object.fromEntries(results))
      } catch {
        // best-effort — 자동완성 실패는 조용히 무시한다.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gateway, connectionId, enabled])

  return useMemo(() => {
    const schemas = Object.keys(tablesBySchema)
    if (schemas.length === 0) return EMPTY
    const namespace: Record<string, Record<string, readonly string[]>> = {}
    for (const [schema, tables] of Object.entries(tablesBySchema)) {
      namespace[schema] = Object.fromEntries(tables.map((tbl) => [tbl, []]))
    }
    const defaultSchema = schemas.includes('public') ? 'public' : schemas[0]
    return { namespace, defaultSchema }
  }, [tablesBySchema])
}
