import { z } from 'zod'

/**
 * `OperationRequest`의 IPC 표현.
 *
 * **`actor`는 없다.** 권한은 renderer가 보낸 값으로 결정하지 않는다 — actor는
 * main의 호출 경로가 만든다. 승인 토큰(`proposalId`)만 renderer가 되돌려 보내고,
 * IPC 라우트가 그것으로 `{ type: 'user', grant }`를 main에서 조립한다.
 *
 * `strictObject`가 아니라 알려진 필드만 뽑는 형태다: renderer가 `actor` 같은
 * 여분 필드를 실어 보내도 조용히 버려지되(strip) 요청 자체는 통과한다. 여기서
 * 거부하면 renderer 버전이 조금만 앞서도 전부 깨지고, 무엇보다 위조된 actor는
 * 통과 여부와 무관하게 이 스키마 밖에서 무시되므로 거부할 이유가 없다.
 */

const sqlOperationSchema = z.object({
  kind: z.literal('sql'),
  sql: z.string(),
  params: z.array(z.unknown()).optional(),
})

const schemaOperationSchema = z.discriminatedUnion('op', [
  z.object({ kind: z.literal('schema'), op: z.literal('listSchemas') }),
  z.object({ kind: z.literal('schema'), op: z.literal('listTables'), schema: z.string() }),
  z.object({
    kind: z.literal('schema'),
    op: z.literal('describeTable'),
    schema: z.string(),
    table: z.string(),
  }),
  z.object({
    kind: z.literal('schema'),
    op: z.literal('listIndexes'),
    schema: z.string(),
    table: z.string(),
  }),
  z.object({
    kind: z.literal('schema'),
    op: z.literal('listForeignKeys'),
    schema: z.string(),
    table: z.string(),
  }),
])

const wireValueSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('null') }),
  z.object({ t: z.literal('bool'), v: z.boolean() }),
  z.object({ t: z.literal('int'), v: z.number() }),
  z.object({ t: z.literal('bigint'), v: z.string() }),
  z.object({ t: z.literal('float'), v: z.number() }),
  z.object({ t: z.literal('decimal'), v: z.string() }),
  z.object({ t: z.literal('str'), v: z.string() }),
  z.object({ t: z.literal('bytes'), v: z.string(), enc: z.literal('base64'), truncated: z.boolean() }),
  z.object({ t: z.literal('date'), v: z.string() }),
  z.object({ t: z.literal('json'), v: z.string(), truncated: z.boolean() }),
  z.object({ t: z.literal('oid'), v: z.string() }),
  z.object({ t: z.literal('unknown'), v: z.string(), note: z.string() }),
])

const rowChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), values: z.record(z.string(), wireValueSchema) }),
  z.object({ op: z.literal('update'), pk: z.record(z.string(), wireValueSchema), set: z.record(z.string(), wireValueSchema) }),
  z.object({ op: z.literal('delete'), pk: z.record(z.string(), wireValueSchema) }),
])

const dataOperationSchema = z.discriminatedUnion('op', [
  z.object({
    kind: z.literal('data'), op: z.literal('browse'),
    schema: z.string(), table: z.string(),
    sort: z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
  }),
  z.object({
    kind: z.literal('data'), op: z.literal('apply'),
    schema: z.string(), table: z.string(),
    changes: z.array(rowChangeSchema),
  }),
])

const documentOperationSchema = z.discriminatedUnion('op', [
  z.object({
    kind: z.literal('document'), op: z.literal('find'),
    collection: z.string().min(1),
    filter: z.string().optional(),
    sort: z.string().optional(),
    limit: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('document'), op: z.literal('aggregate'),
    collection: z.string().min(1),
    pipeline: z.string(),
  }),
  z.object({ kind: z.literal('document'), op: z.literal('listCollections') }),
])

const operationSchema = z.union([
  sqlOperationSchema,
  schemaOperationSchema,
  dataOperationSchema,
  documentOperationSchema,
])

const pageRequestSchema = z.object({
  cursor: z.string().nullable(),
  maxRows: z.number().int(),
  maxBytes: z.number().int(),
})

const executionLimitsSchema = z
  .object({
    timeoutMs: z.number().int(),
    maxRows: z.number().int(),
    maxBytes: z.number().int(),
  })
  .partial()

export const operationRequestSchema = z.object({
  requestId: z.string().min(1),
  connectionId: z.string().min(1),
  operation: operationSchema,
  page: pageRequestSchema.optional(),
  limits: executionLimitsSchema.optional(),
  /**
   * 사용자가 승인한 쓰기 제안서. 있으면 IPC 라우트가 `{ type: 'user', grant }`를
   * 만든다. renderer는 이 id만 되돌려 보내고 문장 원문은 보내지 않는다 — 실행은
   * main이 보관한 원문으로만 한다.
   */
  proposalId: z.string().min(1).optional(),
})

export type OperationRequestDto = z.infer<typeof operationRequestSchema>
