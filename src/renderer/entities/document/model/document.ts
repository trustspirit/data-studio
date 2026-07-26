import type { Capability } from '@shared/types/capability'

/**
 * 탭 하나로 열리는 것. `Operation` 유니온과 같은 관례를 따른다 — 종류가 늘면
 * 아래 switch들이 컴파일 에러로 빠짐을 알려 준다.
 */
export type Document =
  | { readonly kind: 'table'; readonly schema: string; readonly table: string }
  | { readonly kind: 'query'; readonly serial: number }
  | { readonly kind: 'er'; readonly schema: string }
  | { readonly kind: 'collection' }
  | { readonly kind: 'keys' }
  | { readonly kind: 'stream' }
  | { readonly kind: 'items' }

export type DocumentKind = Document['kind']

/** 문서를 열 수 있는지 판정하는 근거. 오늘의 VIEW_CAPABILITY를 계승한다. */
export const DOCUMENT_CAPABILITY: Record<DocumentKind, readonly Capability[]> = {
  table: ['data'],
  query: ['sql'],
  er: ['schema'],
  collection: ['document'],
  keys: ['keyvalue'],
  stream: ['stream'],
  items: ['dynamo'],
}

/** 탭 줄 순서. 사용자가 보는 순서의 단일 출처다. */
const KIND_ORDER: readonly DocumentKind[] = ['table', 'query', 'er', 'collection', 'keys', 'stream', 'items']

/**
 * 연결당 하나뿐인 문서들. 사이드바 트리가 이 엔진들의 객체를 모르기 때문에
 * (schema capability가 없다) 각 뷰가 자체 목록 picker를 들고 있다.
 */
export const SINGLETON_KINDS: readonly DocumentKind[] = ['collection', 'keys', 'stream', 'items']

export function documentKey(doc: Document): string {
  switch (doc.kind) {
    case 'table':
      return `table:${doc.schema}.${doc.table}`
    case 'query':
      return `query:${doc.serial}`
    case 'er':
      return `er:${doc.schema}`
    case 'collection':
    case 'keys':
    case 'stream':
    case 'items':
      return doc.kind
    default: {
      const _exhaustive: never = doc
      return _exhaustive
    }
  }
}

export function documentTitle(doc: Document): string {
  switch (doc.kind) {
    case 'table':
      return doc.table
    case 'query':
      return `Query ${doc.serial}`
    case 'er':
      return `ER: ${doc.schema}`
    case 'collection':
      return 'Collections'
    case 'keys':
      return 'Keys'
    case 'stream':
      return 'Streams'
    case 'items':
      return 'Items'
    default: {
      const _exhaustive: never = doc
      return _exhaustive
    }
  }
}

export function canOpen(kind: DocumentKind, capabilities: readonly Capability[]): boolean {
  return DOCUMENT_CAPABILITY[kind].every((c) => capabilities.includes(c))
}

export function openableKinds(capabilities: readonly Capability[]): readonly DocumentKind[] {
  return KIND_ORDER.filter((k) => canOpen(k, capabilities))
}

/** 접속 직후 자동으로 열어 줄 문서. 싱글턴만 해당한다. */
export function autoDocuments(capabilities: readonly Capability[]): readonly Document[] {
  return openableKinds(capabilities)
    .filter((k) => SINGLETON_KINDS.includes(k))
    .map((k) => ({ kind: k }) as Document)
}

/** 열 수 있는 문서가 싱글턴 하나뿐이면 탭 줄은 크롬 낭비다. */
export function showsTabBar(capabilities: readonly Capability[]): boolean {
  const kinds = openableKinds(capabilities)
  if (kinds.length !== 1) return kinds.length > 1
  return !SINGLETON_KINDS.includes(kinds[0] as DocumentKind)
}
