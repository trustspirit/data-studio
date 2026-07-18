import type { ConnectionConfig } from '../../../shared/types/connection'

export interface ConnectionRepository {
  list(): Promise<ConnectionConfig[]>
  get(id: string): Promise<ConnectionConfig | null>
  save(config: ConnectionConfig): Promise<void>
  delete(id: string): Promise<void>
}
