import { useMemo } from 'react'
import { ThemeProvider, darkTheme, GlobalStyle } from '../shared/theme'
import { GatewayProvider } from './GatewayProvider'
import { buildGateways } from './container'
import { AppShell } from './AppShell'
import type { DataconBridge } from '../gateways/ipc/ipcInvoke'
import { AppErrorBoundary } from './AppErrorBoundary'

// preload가 노출한 다리. 없으면(브라우저 미리보기 등) 즉시 실패시켜 원인을 드러낸다.
function resolveBridge(): DataconBridge {
  const bridge = (globalThis as { datacon?: DataconBridge }).datacon
  if (bridge === undefined) {
    throw new Error('window.datacon bridge is unavailable (preload not loaded)')
  }
  return bridge
}

function ConnectedApp() {
  const gateways = useMemo(() => buildGateways(resolveBridge()), [])
  return <GatewayProvider gateways={gateways}><AppShell /></GatewayProvider>
}

export function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <GlobalStyle />
      <AppErrorBoundary><ConnectedApp /></AppErrorBoundary>
    </ThemeProvider>
  )
}
