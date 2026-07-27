/**
 * 다크 테마 토큰. 상위 스펙 §8의 `darkTheme` 블록을 그대로 옮긴다.
 * 렌더러 색상 값의 단일 출처 — styled 컴포넌트는 하드코딩 대신 이 토큰에 의존한다.
 */
export const darkTheme = {
  color: {
    /** 표면 4단 계단. 명도 17.3 → 27.3 → 38.0 → 50.7 (폭 13.1%). */
    surface: {
      bg: '#101014',
      base: '#191920',
      panel: '#23232c',
      raised: '#2f2f3a',
    },
    /**
     * 행 상태. hover·selected는 반드시 알파 틴트다 — 표면 계단의 값을 재사용하지
     * 않는다(스펙 §4.2). 행은 컨테이너 **위에** 놓이는데 그 컨테이너가 어느 단인지는
     * 컴포넌트마다 다르므로, 불투명 값을 고르면 어떤 컨테이너에서는 같은 색이 되어
     * 상태 표시가 사라진다. 틴트는 밑에 무엇이 있든 그것을 기준으로 들어올린다.
     */
    row: {
      hover: 'rgba(255, 255, 255, 0.055)',
      selected: 'rgba(10, 132, 255, 0.16)',
      staged: '#1e1e26',
      line: '#1e1e26',
    },
    text: {
      primary: '#f2f2f6',
      dim: '#a5a5b2',
      faint: '#6e6e7c',
      disabled: '#4a4a56',
    },
    border: {
      strong: '#3d3d4a',
      soft: '#2a2a34',
    },
    intent: {
      accent: '#0a84ff',
      onAccent: '#ffffff',
      success: '#30d158',
      warning: '#ff9f0a',
      danger: '#ff453a',
      onDanger: '#ffffff',
    },
    intentSoft: {
      accent: 'rgba(10, 132, 255, 0.13)',
      success: 'rgba(48, 209, 88, 0.13)',
      warning: 'rgba(255, 159, 10, 0.13)',
      danger: 'rgba(255, 69, 58, 0.13)',
    },
    /** 은은한 테두리. intentSoft의 0.13은 면에는 맞지만 1px 선으로는 거의 안 보인다. */
    intentBorder: {
      danger: 'rgba(255, 69, 58, 0.35)',
    },
    /** 의미색의 hover 변형. intent는 "의미 넷"이라는 불변식을 지켜야 하므로 분리한다. */
    intentHover: {
      accent: '#2b95ff',
    },
    /** 연결 라벨 전용. 의미 전달이 아니라 사용자가 고르는 구분색이다. */
    label: {
      blue: '#5e9eff',
      purple: '#bf5af2',
      pink: '#ff7ab2',
      teal: '#40c8e0',
      yellow: '#ffd60a',
      green: '#30d158',
      orange: '#ff9f0a',
      red: '#ff453a',
    },
  },
  syntax: {
    keyword: '#ff7ab2',
    fn: '#82aaff',
    string: '#c3e88d',
    // 인용 식별자. 문법이 문자열 리터럴과 구분하므로 색도 구분한다 — DDL은
    // 모든 식별자를 인용하기 때문에 묶어 두면 화면이 한 색이 된다.
    ident: '#c8d3f5',
    number: '#f78c6c',
    type: '#ffcb6b',
    comment: '#787d96',
    punct: '#a6a6b0',
  },
  font: {
    ui: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    mono: "ui-monospace, 'SF Mono', Menlo, monospace",
  },
  // 타이포 스케일 — 컴포넌트별 임의 font-size 대신 이 세 단계만 쓴다.
  fontSize: { label: '11px', body: '13px', heading: '15px', title: '20px' },
  fontWeight: { regular: 400, medium: 500, semibold: 600 },
  // 스페이싱 스케일 — 4px 그리드.
  space: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  radius: { sm: '4px', md: '6px', lg: '10px' },
  // 레이아웃 치수 — 문자열은 CSS에 그대로 쓰이고, 숫자는 SplitPane의 클램프에 쓰인다.
  size: {
    rail: '56px',
    sidebar: '240px',
    sidebarDefault: 240,
    sidebarMin: 180,
    sidebarMax: 520,
    inspectorDefault: 280,
    inspectorMin: 220,
    inspectorMax: 560,
    editorDefault: 260,
    editorMin: 120,
    editorMax: 720,
  },
  density: { rowPad: '6px 12px', rowHeight: '28px', controlHeight: '28px', controlPad: '5px 10px' },
} as const

export type AppTheme = typeof darkTheme
