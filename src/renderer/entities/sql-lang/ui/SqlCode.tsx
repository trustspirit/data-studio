import type { ComponentPropsWithoutRef } from 'react'
import styled from 'styled-components'
import type { EngineId } from '@shared/types/connection'
import { sqlTokenCss, tokenizeSql } from '../model/sqlTokens'

/**
 * 읽기 전용 SQL 표시. 편집기 인스턴스 없이 토큰 조각을 span으로 그린다.
 *
 * 색·서식은 `sqlTokenCss`가 편집기와 같은 표에서 만든다 — 미리보기와 편집기의
 * 색이 갈라지지 않는다.
 */
const Pre = styled.pre`
  margin: 0;
  padding: ${({ theme }) => theme.space.sm};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.gridBg};
  color: ${({ theme }) => theme.color.text};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  white-space: pre-wrap;
  word-break: break-all;
  ${({ theme }) => sqlTokenCss(theme)}
`

interface SqlCodeProps extends ComponentPropsWithoutRef<'pre'> {
  /** 엔진 id를 받아 내부에서 방언을 고른다 — 호출부가 CodeMirror를 알 필요가 없다. */
  readonly engine: EngineId | undefined
  readonly code: string
}

export function SqlCode({ engine, code, ...rest }: SqlCodeProps) {
  const pieces = tokenizeSql(engine, code)
  return (
    <Pre {...rest}>
      {pieces.map((piece, i) =>
        piece.token === null ? (
          <span key={i}>{piece.text}</span>
        ) : (
          <span key={i} className={`tok-${piece.token}`}>
            {piece.text}
          </span>
        ),
      )}
    </Pre>
  )
}
