import type { Capability, Driver } from './Driver'

/**
 * 드라이버의 능력을 renderer로 보낼 수 있는 문자열 목록으로 옮긴다.
 *
 * capability 객체 자체는 함수를 담고 있어 IPC를 건널 수 없다. 이 목록은
 * **실제 객체의 존재 여부에서 파생**되므로 선언과 구현이 어긋날 수 없다 —
 * 별도로 관리하는 문자열 배열이었다면 어긋날 수 있다.
 */
export function describeCapabilities(driver: Driver): Capability[] {
  const capabilities: Capability[] = []

  if (driver.sql !== undefined) capabilities.push('sql')
  if (driver.schema !== undefined) capabilities.push('schema')

  return capabilities
}
