import styled, { css } from 'styled-components'

/** 폼 컨트롤 공통 스타일 — TextField/Select/bare Input이 모두 공유한다. */
export const controlCss = css`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  padding: ${({ theme }) => theme.density.controlPad};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface.base};
  color: ${({ theme }) => theme.color.fg.primary};
  /* 테두리는 자리를 잡되 색을 두지 않는다 — 포커스에서만 나타나므로
     레이아웃이 흔들리지 않는다. */
  border: 1px solid transparent;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.intent.accent};
  }
  &:disabled {
    background: ${({ theme }) => theme.color.surface.bg};
    color: ${({ theme }) => theme.color.fg.disabled};
  }
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
