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
    /**
     * 구분색 팔레트. 의미(intent) 넷과 달리 "무엇을 뜻하는가"를 전달하지 않고
     * "서로 다르다"만 전달한다.
     *
     * 이름은 연결 라벨에서 왔지만 그 소비자는 아직 없다 — 지금 쓰는 곳은 앱이
     * 고정한 범주색 둘뿐이다(AiChatPanel의 `ToolChip` = 어떤 AI 도구가 돌았나,
     * AuditView의 `ActorBadge` = AI인가 사람인가). 사용자가 고르는 색과 앱이
     * 고르는 색이 한 네임스페이스에 얹혀 있는 상태다.
     *
     * 데이터 두 점으로 분류 체계를 미리 만들지 않는다. 연결 라벨 색상 선택기가
     * 들어오는 다음 프로젝트에서 둘을 쪼갤지 정한다.
     */
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
  // 타이포 스케일 — 컴포넌트별 임의 font-size 대신 이 네 단계만 쓴다.
  // 값은 관대한 쪽으로 잡는다: 앞 시스템의 11–20px는 구조는 맞았지만 주요 작업
  // 화면(DataView·QueryWorkspace·ErView) 어디에도 13px을 넘는 글자가 없어
  // 위계가 위계로 읽히지 않았다. heading·title의 상향 폭이 큰 것은 의도다 —
  // 이 둘의 사용처는 진짜 제목 다섯 곳뿐이고, 상단이 상단으로 보이려면
  // 본문과의 거리가 필요하다.
  fontSize: { label: '14px', body: '16px', heading: '24px', title: '32px' },
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
  /**
   * 밀도. `controlHeight`는 **반드시 소비돼야 하는 토큰**이다 — 컨트롤이 높이를
   * 명시하지 않으면 높이가 패딩과 글자 크기에서 우연히 나오고, 한 툴바 안에서
   * 두세 가지 높이가 섞인다(이전 상태: sm ≈ 19px, md ≈ 25px).
   *
   * `controlPad`가 가로 전용인 것도 같은 이유다. 세로 성분이 남아 있으면
   * 높이 고정과 경쟁한다.
   */
  density: {
    rowPad: '8px 14px',
    rowHeight: '36px',
    controlHeight: '44px',
    controlHeightSm: '32px',
    controlPad: '0 16px',
  },
} as const

export type AppTheme = typeof darkTheme
