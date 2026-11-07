import { Component, type ReactNode } from 'react'
import styled from 'styled-components'
import { Button } from '../shared/ui'

const Fallback = styled.main`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.space.lg};
  padding: ${({ theme }) => theme.space.xl};
  text-align: center;
  h1 { font-size: ${({ theme }) => theme.fontSize.heading}; margin: 0; }
  p { max-width: 520px; margin: 0; color: ${({ theme }) => theme.color.text.dim}; line-height: 1.6; }
`

/** Keep startup and render failures actionable instead of leaving an empty window. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  override render() {
    if (!this.state.failed) return this.props.children
    return <Fallback role="alert">
      <h1>작업 화면을 불러오지 못했습니다</h1>
      <p>다시 시도해 화면을 복구할 수 있습니다. 문제가 계속되면 데스크톱 앱을 재시작하세요.
        브라우저에서 실행한 경우 Electron 앱으로 열어야 합니다.</p>
      <p>다시 시도하면 열려 있던 화면과 적용하지 않은 편집이 초기화됩니다.</p>
      <Button onClick={() => this.setState({ failed: false })}>다시 시도</Button>
    </Fallback>
  }
}
