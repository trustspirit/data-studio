import styled, { css } from 'styled-components'

/** 폼 컨트롤 공통 스타일 — TextField/Select/bare Input이 모두 공유한다. */
export const controlCss = css`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  /* 버튼과 같은 줄에 서야 하므로 같은 높이 토큰을 쓴다. 소비자가 전부
     한 줄짜리 input/select라 세로 중앙 정렬은 브라우저가 해 준다. */
  height: ${({ theme }) => theme.density.controlHeight};
  padding: ${({ theme }) => theme.density.controlPad};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface.base};
  color: ${({ theme }) => theme.color.text.primary};
  /* 채움만으로는 안 보인다 — 필드면(#191920)과 컨테이너 surface.panel(#23232c)의
     대비가 1.12:1이라 쉬는 상태에서 경계가 사라진다. 상시 테두리로 1.46:1을 만든다.
     자리는 늘 차지하므로 포커스·오류로 색만 바뀌고 레이아웃은 안 움직인다. */
  border: 1px solid ${({ theme }) => theme.color.border.strong};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.intent.accent};
  }
  &:disabled {
    background: ${({ theme }) => theme.color.surface.bg};
    color: ${({ theme }) => theme.color.text.disabled};
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
