import {
  MariaSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
} from '@codemirror/lang-sql'
import { snippetCompletion, type Completion } from '@codemirror/autocomplete'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { EngineId } from '@shared/types/connection'
import type { AppTheme } from '../../../shared/theme'

/**
 * 엔진별 CodeMirror SQL 방언. SQL이 아닌 엔진(또는 미지정)은 표준 SQL로
 * 폴백한다 — 키워드 자동완성과 하이라이트는 그대로 동작한다.
 */
export function dialectFor(engine: EngineId | undefined): SQLDialect {
  switch (engine) {
    case 'postgres':
      return PostgreSQL
    case 'mysql':
      return MySQL
    case 'mariadb':
      return MariaSQL
    case 'sqlite':
      return SQLite
    default:
      return StandardSQL
  }
}

/**
 * 자주 쓰는 SQL 골격 스니펫. `${}` 자리는 Tab으로 순회하며 채운다.
 * label로 자동완성 목록에 노출된다 (예: "sel" 입력 → SELECT 골격).
 */
export const SQL_SNIPPETS: readonly Completion[] = [
  snippetCompletion('SELECT ${*} FROM ${table} WHERE ${condition};', {
    label: 'sel',
    detail: 'SELECT … FROM … WHERE …',
    type: 'keyword',
  }),
  snippetCompletion('SELECT ${*} FROM ${table} LIMIT ${100};', {
    label: 'sell',
    detail: 'SELECT … LIMIT …',
    type: 'keyword',
  }),
  snippetCompletion('SELECT COUNT(*) FROM ${table};', {
    label: 'selc',
    detail: 'SELECT COUNT(*)',
    type: 'keyword',
  }),
  snippetCompletion('INSERT INTO ${table} (${columns}) VALUES (${values});', {
    label: 'ins',
    detail: 'INSERT INTO …',
    type: 'keyword',
  }),
  snippetCompletion('UPDATE ${table} SET ${column} = ${value} WHERE ${condition};', {
    label: 'upd',
    detail: 'UPDATE … SET … WHERE …',
    type: 'keyword',
  }),
  snippetCompletion('DELETE FROM ${table} WHERE ${condition};', {
    label: 'del',
    detail: 'DELETE FROM … WHERE …',
    type: 'keyword',
  }),
  snippetCompletion('JOIN ${table} ON ${left} = ${right}', {
    label: 'join',
    detail: 'JOIN … ON …',
    type: 'keyword',
  }),
  snippetCompletion('LEFT JOIN ${table} ON ${left} = ${right}', {
    label: 'ljoin',
    detail: 'LEFT JOIN … ON …',
    type: 'keyword',
  }),
  snippetCompletion('GROUP BY ${columns} HAVING ${condition}', {
    label: 'grp',
    detail: 'GROUP BY … HAVING …',
    type: 'keyword',
  }),
  snippetCompletion('ORDER BY ${column} ${DESC}', {
    label: 'ord',
    detail: 'ORDER BY …',
    type: 'keyword',
  }),
  snippetCompletion('WITH ${cte} AS (\n  SELECT ${*} FROM ${table}\n)\nSELECT ${*} FROM ${cte};', {
    label: 'cte',
    detail: 'WITH … AS (…)',
    type: 'keyword',
  }),
  snippetCompletion('CREATE TABLE ${table} (\n  id ${type} PRIMARY KEY,\n  ${column} ${type}\n);', {
    label: 'ctab',
    detail: 'CREATE TABLE …',
    type: 'keyword',
  }),
]

/** `theme.syntax` 토큰으로 SQL 구문 하이라이트 스타일을 만든다. */
export function sqlHighlight(theme: AppTheme): HighlightStyle {
  return HighlightStyle.define([
    { tag: t.keyword, color: theme.syntax.keyword, fontWeight: '600' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: theme.syntax.fn },
    { tag: [t.string, t.special(t.string)], color: theme.syntax.string },
    { tag: [t.number, t.bool, t.null], color: theme.syntax.number },
    { tag: [t.typeName, t.className], color: theme.syntax.type },
    { tag: t.comment, color: theme.syntax.comment, fontStyle: 'italic' },
    { tag: [t.punctuation, t.separator, t.operator], color: theme.syntax.punct },
  ])
}
