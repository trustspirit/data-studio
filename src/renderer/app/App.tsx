import { useMemo } from 'react'
import { ThemeProvider, darkTheme } from '../shared/theme'
import { GatewayProvider } from './GatewayProvider'
import { buildGateways } from './container'
import { ConnectionsScreen } from '../features/connections'
import type { DataconBridge } from '../gateways/ipc/ipcInvoke'

// preload가 노출한 다리. 없으면(브라우저 미리보기 등) 즉시 실패시켜 원인을 드러낸다.
function resolveBridge(): DataconBridge {
  const bridge = (globalThis as { datacon?: DataconBridge }).datacon
  if (bridge === undefined) {
    throw new Error('window.datacon bridge is unavailable (preload not loaded)')
  }
  return bridge
}

export function App() {
  const gateways = useMemo(() => buildGateways(resolveBridge()), [])
  return (
    <ThemeProvider theme={darkTheme}>
      <GatewayProvider gateways={gateways}>
        <ConnectionsScreen />
      </GatewayProvider>
    </ThemeProvider>
  )
}
