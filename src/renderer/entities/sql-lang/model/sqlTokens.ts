import {
  MariaSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
} from '@codemirror/lang-sql'
import { HighlightStyle } from '@codemirror/language'
import {
  highlightCode,
  tagHighlighter,
  tags as t,
  type Highlighter,
  type Tag,
} from '@lezer/highlight'
import type { EngineId } from '@shared/types/connection'
import type { AppTheme } from '../../../shared/theme'

/**
 * SQL 구문 색상의 단일 출처.
 *
 * `features/query`(CodeMirror 편집기)와 `features/structure`(DDL 미리보기)가
 * 둘 다 쓴다. ESLint가 feature끼리의 import를 막으므로 여기 `entities`에 있다.
 */

/** 엔진별 CodeMirror SQL 방언. SQL이 아닌 엔진은 표준 SQL로 폴백한다. */
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

export type SqlToken = 'keyword' | 'fn' | 'ident' | 'string' | 'number' | 'type' | 'comment' | 'punct'

interface TokenRule {
  readonly tag: Tag | readonly Tag[]
  readonly token: SqlToken
  /** 색 외의 서식. HighlightStyle과 정적 CSS가 함께 쓴다. */
  readonly emphasis?: { readonly fontWeight?: string; readonly fontStyle?: string }
}

/**
 * 태그 → 의미 토큰 표.
 *
 * 편집기용 `HighlightStyle`과 정적 렌더링용 하이라이터를 **둘 다 이 표에서**
 * 파생한다. 표를 두 벌로 두면 편집기와 미리보기의 색이 갈라진다.
 *
 * `emphasis`까지 표에 넣은 이유도 같다. 서식만 표 밖에 남기면 색은 공유하고
 * 굵기·기울기는 또 갈라진다.
 *
 * `special(string)`과 `string`이 따로 있는 것이 이 표의 핵심 변경이다. 예전
 * 정의는 둘을 한 색으로 묶었는데, DDL은 모든 식별자를 인용하므로 미리보기가
 * 거의 한 색이 된다. 두 태그가 실제로 갈라지는지는 테스트가 지킨다.
 */
const SQL_TOKENS: readonly TokenRule[] = [
  { tag: t.keyword, token: 'keyword', emphasis: { fontWeight: '600' } },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], token: 'fn' },
  { tag: t.special(t.string), token: 'ident' },
  { tag: t.string, token: 'string' },
  { tag: [t.number, t.bool, t.null], token: 'number' },
  { tag: [t.typeName, t.className], token: 'type' },
  { tag: t.comment, token: 'comment', emphasis: { fontStyle: 'italic' } },
  { tag: [t.punctuation, t.separator, t.operator], token: 'punct' },
]

/** `theme.syntax` 토큰으로 CodeMirror 하이라이트 스타일을 만든다. */
export function sqlHighlight(theme: AppTheme): HighlightStyle {
  return HighlightStyle.define(
    SQL_TOKENS.map((rule) => ({
      tag: rule.tag,
      color: theme.syntax[rule.token],
      ...rule.emphasis,
    })),
  )
}

const staticHighlighter: Highlighter = tagHighlighter(
  SQL_TOKENS.map((rule) => ({ tag: rule.tag, class: `tok-${rule.token}` })),
)

export interface SqlPiece {
  readonly text: string
  /** 어느 토큰도 아니면 null (공백, 한정자 점 등). */
  readonly token: SqlToken | null
}

function tokenOf(classes: string): SqlToken | null {
  // tagHighlighter는 클래스를 공백으로 이어 준다. 규칙당 클래스는 하나뿐이다.
  const found = classes.split(' ').find((c) => c.startsWith('tok-'))
  return found === undefined ? null : (found.slice('tok-'.length) as SqlToken)
}

/**
 * SQL을 토큰 조각으로 나눈다. 편집기 인스턴스를 만들지 않는다.
 *
 * 읽기 전용 CodeMirror를 띄우는 대신 이 길을 고른 이유는 셋이다. 정적
 * 텍스트에 편집기 수명주기가 필요 없고, 미리보기가 폼 입력마다 다시 그려지는데
 * 문서 갱신 왕복이 없고, 테스트가 토큰을 값으로 그대로 확인할 수 있다.
 */
export function tokenizeSql(engine: EngineId | undefined, code: string): readonly SqlPiece[] {
  const tree = dialectFor(engine).language.parser.parse(code)
  const pieces: SqlPiece[] = []
  highlightCode(
    code,
    tree,
    staticHighlighter,
    (text, classes) => {
      pieces.push({ text, token: tokenOf(classes) })
    },
    () => {
      // 줄바꿈은 텍스트 콜백으로 오지 않는다 — 여기서 직접 넣어야 원문이 보존된다.
      pieces.push({ text: '\n', token: null })
    },
  )
  return pieces
}

/**
 * 정적 렌더링용 토큰 CSS. `SQL_TOKENS`에서 파생하므로 편집기와 어긋나지 않는다.
 */
export function sqlTokenCss(theme: AppTheme): string {
  return SQL_TOKENS.map((rule) => {
    const decls = [`color: ${theme.syntax[rule.token]}`]
    const weight = rule.emphasis?.fontWeight
    const style = rule.emphasis?.fontStyle
    if (weight !== undefined) decls.push(`font-weight: ${weight}`)
    if (style !== undefined) decls.push(`font-style: ${style}`)
    return `& .tok-${rule.token} { ${decls.join('; ')}; }`
  }).join('\n')
}
