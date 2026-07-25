import styled, { css } from 'styled-components'

/** 폼 컨트롤 공통 스타일 — TextField/Select/bare Input이 모두 공유한다. */
export const controlCss = css`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.md};
  padding: 6px 8px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.gridBg};
  color: ${({ theme }) => theme.color.text};
  border: 1px solid ${({ theme }) => theme.color.border};
`

/** 툴바 등에 넣는 라벨 없는 한 줄 입력. */
export const Input = styled.input`
  ${controlCss}
  min-width: 0;
`
Input.displayName = 'Input'

/** 툴바 등에 넣는 라벨 없는 셀렉트. */
export const NativeSelect = styled.select`
  ${controlCss}
`
NativeSelect.displayName = 'NativeSelect'
