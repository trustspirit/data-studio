/**
 * 다크 테마 토큰. 상위 스펙 §8의 `darkTheme` 블록을 그대로 옮긴다.
 * 렌더러 색상 값의 단일 출처 — styled 컴포넌트는 하드코딩 대신 이 토큰에 의존한다.
 */
export const darkTheme = {
  color: {
    winBg: '#1a1a1e',
    titlebar: '#26262b',
    toolbar: '#202024',
    sidebar: '#1c1c20',
    panel: '#212127',
    gridBg: '#1a1a1f',
    gridHeader: '#232329',
    rowHover: '#26262e',
    rowAlt: '#1e1e23',
    border: '#33333b',
    borderSoft: '#2a2a31',
    text: '#e7e7ec',
    textDim: '#9a9aa4',
    textFaint: '#63636d',
    accent: '#0a84ff',
    green: '#30d158',
    orange: '#ff9f0a',
    red: '#ff453a',
    purple: '#bf5af2',
    pink: '#ff7ab2',
    teal: '#40c8e0',
    yellow: '#ffd60a',
    blue: '#5e9eff',
  },
  syntax: {
    keyword: '#ff7ab2',
    fn: '#82aaff',
    string: '#c3e88d',
    number: '#f78c6c',
    type: '#ffcb6b',
    comment: '#6b7089',
    punct: '#a6a6b0',
  },
  font: {
    ui: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  },
  density: { rowPad: '4px 12px' },
} as const

export type AppTheme = typeof darkTheme
