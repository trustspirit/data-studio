import { createContext, useContext, type ReactNode } from 'react'
import type { Gateways } from './container'

const GatewayContext = createContext<Gateways | null>(null)

export function GatewayProvider({
  gateways,
  children,
}: {
  gateways: Gateways
  children: ReactNode
}) {
  return <GatewayContext.Provider value={gateways}>{children}</GatewayContext.Provider>
}

export function useGateways(): Gateways {
  const ctx = useContext(GatewayContext)
  if (ctx === null) {
    throw new Error('useGateways must be used within a GatewayProvider')
  }
  return ctx
}
