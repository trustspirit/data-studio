import { useState, type ReactNode } from 'react'
import styled from 'styled-components'

const Dock = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.panel};
  border-left: 1px solid ${({ theme }) => theme.color.borders.strong};
  overflow: hidden;
`
const Section = styled.div<{ $grow: boolean }>`
  display: flex;
  flex-direction: column;
  min-height: 0;
  ${({ $grow }) => ($grow ? 'flex: 1;' : '')}
`
const Header = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  width: 100%;
  text-align: left;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.heading};
  font-weight: ${({ theme }) => theme.fontWeight.semibold};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.color.borders.soft};
  background: transparent;
  color: ${({ theme }) => theme.color.fg.dim};
  cursor: pointer;
  &:hover {
    color: ${({ theme }) => theme.color.fg.primary};
  }
`
const Body = styled.div<{ $grow: boolean }>`
  min-height: 0;
  overflow: auto;
  ${({ $grow }) => ($grow ? 'flex: 1;' : 'max-height: 40vh;')}
`

export interface InspectorSection {
  readonly id: string
  readonly title: string
  readonly content: ReactNode
  /** 펼쳐졌을 때 남은 높이를 전부 차지한다. AI 대화처럼 잘리면 못 쓰는 내용용. */
  readonly grow?: boolean
}

interface InspectorDockProps {
  sections: readonly InspectorSection[]
  /** 처음부터 펼쳐 둘 섹션 id. */
  initiallyOpen?: readonly string[] | undefined
}

export function InspectorDock({ sections, initiallyOpen = [] }: InspectorDockProps) {
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>(() =>
    Object.fromEntries(initiallyOpen.map((id) => [id, true])),
  )
  return (
    <Dock>
      {sections.map((s) => {
        const expanded = open[s.id] === true
        const grow = s.grow === true && expanded
        return (
          <Section key={s.id} $grow={grow}>
            <Header
              type="button"
              aria-expanded={expanded}
              data-testid={`inspector-section-${s.id}`}
              onClick={() => setOpen((cur) => ({ ...cur, [s.id]: cur[s.id] !== true }))}
            >
              {expanded ? '▾' : '▸'} {s.title}
            </Header>
            {expanded && (
              <Body $grow={grow} data-testid={`inspector-body-${s.id}`}>
                {s.content}
              </Body>
            )}
          </Section>
        )
      })}
    </Dock>
  )
}
