import { z } from 'zod'

const name = z.string().min(1).max(512)
export const workspaceDocumentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('query'), serial: z.number().int().positive() }),
  z.object({ kind: z.literal('table'), schema: name, table: name }),
  z.object({ kind: z.literal('er'), schema: name }),
  ...(['collection', 'keys', 'stream', 'items'] as const).map((kind) => z.object({ kind: z.literal(kind) })),
])
export const workspaceTabsSchema = z.object({
  documents: z.array(workspaceDocumentSchema).max(100),
  activeKey: z.string().max(2048).nullable(),
})
export const workspaceSchema = z.object({
  tabs: workspaceTabsSchema,
  drafts: z.record(z.string().regex(/^\d+$/), z.string().max(262_144)),
})
export type SavedWorkspace = z.infer<typeof workspaceSchema>
export type SavedTabs = z.infer<typeof workspaceTabsSchema>
export const emptyWorkspace = (): SavedWorkspace => ({ tabs: { documents: [], activeKey: null }, drafts: {} })
