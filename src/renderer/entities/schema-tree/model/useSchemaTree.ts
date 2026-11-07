import { useCallback, useEffect, useRef, useState } from 'react'
import type { SchemaInfo, TableInfo } from '../../../../shared/types/schema'
import type { OperationRequestDto } from '../../../../shared/contracts/operationDto'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { failureText } from '../../../shared/lib'

export interface SchemaTreeState {
  readonly schemas: readonly SchemaInfo[]
  readonly tablesBySchema: Readonly<Record<string, readonly TableInfo[]>>
  readonly expanded: Readonly<Record<string, boolean>>
  toggle: (schema: string) => void
  /** DDL 실행 등으로 서버 쪽 스키마가 바뀐 뒤 트리 전체를 다시 읽는다. */
  reload: () => void
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useSchemaTree(gateway: OperationGateway, connectionId: string): SchemaTreeState {
  const [schemas, setSchemas] = useState<readonly SchemaInfo[]>([])
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, readonly TableInfo[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const mounted = useRef(true)
  // 요청한 스키마를 ref로 추적한다. setState 업데이터 안에서 fetch를 튕기면
  // StrictMode가 업데이터를 두 번 호출해 listTables가 중복 발사된다 — ref로
  // 업데이터 밖에서 "이미 요청함"을 판정해 정확히 한 번만 fetch한다.
  const requested = useRef<Set<string>>(new Set())
  const generation = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    // 연결이 바뀌면 이전 연결의 테이블 캐시를 버린다 — 훅 인스턴스가 재사용될 수
    // 있어(연결 전환이 remount를 보장하지 않는다) 스키마명이 겹치면 옛 테이블이 남는다.
    requested.current = new Set()
    generation.current += 1
    setTablesBySchema({})
    setExpanded({})
    setError(null)
    let cancelled = false
    const request: OperationRequestDto = {
      requestId: crypto.randomUUID(),
      connectionId,
      operation: { kind: 'schema', op: 'listSchemas' },
    }
    void (async () => {
      try {
        const outcome = await gateway.run(request)
        if (cancelled || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'schemas') setSchemas(outcome.payload.schemas)
        else if (!outcome.ok) setError(failureText(outcome))
      } catch (e) {
        if (!cancelled && mounted.current) setError(messageOf(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gateway, connectionId, version])

  const reload = useCallback(() => {
    // 위 effect의 deps에 version이 있으므로 증가만으로 캐시 리셋 + 재조회가 일어난다
    // (연결 전환과 동일한 경로 — 별도 재조회 코드를 두 벌 유지하지 않는다).
    setVersion((v) => v + 1)
  }, [])

  const toggle = useCallback(
    (schema: string) => {
      const token = generation.current
      setExpanded((prev) => ({ ...prev, [schema]: prev[schema] !== true }))
      if (requested.current.has(schema)) return // 이미 요청함 — 다시 fetch 안 함(캐시)
      requested.current.add(schema)
      void (async () => {
        try {
          const outcome = await gateway.run({
            requestId: crypto.randomUUID(),
            connectionId,
            operation: { kind: 'schema', op: 'listTables', schema },
          })
          if (!mounted.current || token !== generation.current) return
          if (outcome.ok && outcome.payload.kind === 'tables') {
            const tables = outcome.payload.tables
            setTablesBySchema((cur) => ({ ...cur, [schema]: tables }))
          } else if (!outcome.ok) {
            requested.current.delete(schema) // 실패 시 재요청 허용
            setError(failureText(outcome))
          }
        } catch (e) {
          if (token !== generation.current) return
          requested.current.delete(schema) // 실패 시 재요청 허용
          if (mounted.current) setError(messageOf(e))
        }
      })()
    },
    [gateway, connectionId],
  )

  return { schemas, tablesBySchema, expanded, toggle, reload, error }
}
