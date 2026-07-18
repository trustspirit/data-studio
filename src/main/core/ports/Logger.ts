export interface Logger {
  warn(event: string, detail: Record<string, unknown>): void
}
