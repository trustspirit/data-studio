import { createGlobalStyle } from 'styled-components'

/**
 * 렌더러 전역 스타일. Electron 단일 창 앱이므로 셸이 스크롤을 소유하고
 * body 자체는 스크롤하지 않는다. box-sizing/margin 리셋이 없으면 중첩
 * height 계산이 어긋나 겹침·이중 스크롤이 생긴다.
 */
export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
  }
  html, body, #root {
    height: 100%;
  }
  body {
    margin: 0;
    overflow: hidden;
    background: ${({ theme }) => theme.color.winBg};
    color: ${({ theme }) => theme.color.text};
    font-family: ${({ theme }) => theme.font.ui};
    font-size: ${({ theme }) => theme.fontSize.md};
    -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.color.border};
    border-radius: 5px;
    border: 2px solid transparent;
    background-clip: content-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: ${({ theme }) => theme.color.textFaint};
    background-clip: content-box;
  }
  ::-webkit-scrollbar-corner {
    background: transparent;
  }
  :focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.accent};
    outline-offset: -2px;
  }
`
