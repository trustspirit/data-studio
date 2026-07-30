// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme, type AppTheme } from '@renderer/shared/theme'
import { Icon } from '@renderer/shared/ui'

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('Icon', () => {
  it('크기가 부모 폰트 크기에 영향받지 않는다 — 아이콘은 자기 크기 토큰을 쓴다', () => {
    // 지키려는 성질은 "값이 fontSize와 다르다"가 아니라 "타이포에서 독립"이다.
    // (iconSm 14px와 fontSize.label 14px는 실제로 같고, 그건 결함이 아니다.)
    // em이나 상속 단위로 회귀하면 이 단언이 깨진다.
    const { container } = wrap(
      <div style={{ fontSize: '40px' }}>
        <Icon name="close" />
      </div>,
    )
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.getAttribute('width')).toBe(darkTheme.size.icon)
    expect(svg.getAttribute('height')).toBe(darkTheme.size.icon)
  })

  it('세 크기가 각자의 토큰을 쓴다', () => {
    const { container } = wrap(
      <>
        <Icon name="plus" size="sm" />
        <Icon name="plus" size="lg" />
      </>,
    )
    const [sm, lg] = Array.from(container.querySelectorAll('svg'))
    expect(sm?.getAttribute('width')).toBe(darkTheme.size.iconSm)
    expect(lg?.getAttribute('width')).toBe(darkTheme.size.iconLg)
  })

  it('sm이 fontSize 토큰이 아니라 진짜 size.iconSm을 읽는다 — 값이 우연히 같은 darkTheme만으로는 못 잡는 회귀다', () => {
    // darkTheme에서는 size.iconSm과 fontSize.label이 둘 다 14px라 우연히 같다
    // (결함 아님, 위 코멘트 참고). 그래서 sm 크기를 fontSize.label에서 읽어 오는
    // 회귀가 있어도 darkTheme으로 렌더하면 폭 값이 똑같이 나와 들키지 않는다.
    // size 토큰군과 fontSize 토큰군이 서로 겹치지 않도록 바꾼 테마로 렌더해,
    // 세 크기 모두 자기 몫의 size 토큰만 읽고 어떤 fontSize 토큰도 우연히
    // 대신할 수 없음을 확정적으로 확인한다.
    // AppTheme은 darkTheme을 `as const`로 고정한 타입이라 필드 값이 리터럴로
    // 못박혀 있다 — 다른 값을 넣으려면 타입 검사를 우회해야 한다. 런타임에
    // ThemeProvider에 전달되는 순수 데이터일 뿐이라 여기서는 안전하다.
    const probeTheme = {
      ...darkTheme,
      size: { ...darkTheme.size, iconSm: '11px', icon: '19px', iconLg: '29px' },
      fontSize: { ...darkTheme.fontSize, label: '41px', body: '42px', heading: '43px', title: '44px' },
    } as unknown as AppTheme
    const { container } = render(
      <ThemeProvider theme={probeTheme}>
        <Icon name="plus" size="sm" />
        <Icon name="plus" />
        <Icon name="plus" size="lg" />
      </ThemeProvider>,
    )
    const [sm, md, lg] = Array.from(container.querySelectorAll('svg'))
    const widths = [sm?.getAttribute('width'), md?.getAttribute('width'), lg?.getAttribute('width')]
    expect(widths).toEqual(['11px', '19px', '29px'])
    // 세 값이 서로 다르다는 것도 확인해 둔다 — 어느 한 fontSize 토큰이 세
    // 크기 전부를 동시에 대신할 길이 없음을 명시적으로 못 박는다.
    expect(new Set(widths).size).toBe(3)
  })

  it('색은 반대로 부모에 연동한다 — hover·비활성에서 글자와 함께 움직여야 한다', () => {
    // 크기는 독립, 색은 연동이 이 설계의 요지다. 색을 고정하면 hover에서 라벨만
    // 밝아지고 아이콘은 그대로 남아 둘이 갈라진다.
    const { container } = wrap(<Icon name="chevronRight" />)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('fill')).toBe('none')
  })

  it('어느 도형도 색을 직접 박아 두지 않는다', () => {
    // 여섯 종 중 하나라도 #a5a5b2 같은 값을 들고 있으면 그 아이콘만 테마에서
    // 떨어져 나온다. currentColor 외의 색은 아이콘 안에 존재할 이유가 없다.
    const names = ['chevronRight', 'chevronDown', 'close', 'plus', 'more', 'refresh'] as const
    for (const name of names) {
      const { container } = wrap(<Icon name={name} />)
      const svg = container.querySelector('svg') as SVGElement
      const hardcoded = Array.from(svg.querySelectorAll('*')).filter((el) => {
        const paint = `${el.getAttribute('fill') ?? ''} ${el.getAttribute('stroke') ?? ''}`
        return /#|rgb|hsl/.test(paint)
      })
      expect(hardcoded.map((el) => `${name}/${el.tagName}`)).toEqual([])
    }
  })

  it('기본은 장식이다 — 스크린리더에 두 번 읽히지 않는다', () => {
    const { container } = wrap(<Icon name="close" />)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('role')).toBeNull()
  })

  it('label을 주면 아이콘 자신이 이름을 갖는다', () => {
    const { container } = wrap(<Icon name="refresh" label="새로고침" />)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('새로고침')
    expect(svg.getAttribute('aria-hidden')).toBeNull()
  })

  it('여섯 종을 전부 그린다 — 이름만 있고 도형이 없는 항목을 막는다', () => {
    const names = ['chevronRight', 'chevronDown', 'close', 'plus', 'more', 'refresh'] as const
    for (const name of names) {
      const { container } = wrap(<Icon name={name} />)
      const svg = container.querySelector('svg') as SVGElement
      expect(svg.innerHTML.length, `${name}이(가) 비어 있다`).toBeGreaterThan(0)
    }
  })
})
