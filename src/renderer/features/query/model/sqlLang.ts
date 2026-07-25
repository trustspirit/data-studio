import { snippetCompletion, type Completion } from '@codemirror/autocomplete'

/**
 * 질의 편집기 전용 자동완성 스니펫.
 *
 * 방언 선택과 구문 하이라이트는 `entities/sql-lang`으로 내려갔다 — DDL
 * 미리보기가 같은 정의를 써야 하고, ESLint가 feature끼리의 import를 막는다.
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
