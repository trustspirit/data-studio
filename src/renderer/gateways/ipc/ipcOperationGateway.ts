import type { OperationRequestDto } from '../../../shared/contracts/operationDto'
import type {
  AuditEntry,
  OperationGateway,
  OperationOutcome,
} from '../ports/OperationGateway'
import { invokeUnwrapped, type DataconBridge } from './ipcInvoke'

/**
 * `window.datacon.invoke`를 감싸는 실행 게이트웨이.
 *
 * `run`의 요청에는 actor가 없다 — 권한은 main이 정한다. `OperationResult`의
 * `{ ok: false, reason }`은 IPC 전송 실패(`IpcResult`의 `{ ok: false, code }`)와
 * 다른 층위다: 앞은 도메인 거부(정책 거부 등)이고 뒤는 전송 자체의 실패다.
 * 게이트웨이는 뒤만 오류로 던지고, 앞은 값으로 그대로 돌려준다.
 */
export function createIpcOperationGateway(bridge: DataconBridge): OperationGateway {
  return {
    run: (request: OperationRequestDto) =>
      invokeUnwrapped<OperationOutcome>(bridge, 'operation:run', request),
    cancel: async (requestId) => {
      await invokeUnwrapped<null>(bridge, 'operation:cancel', { requestId })
    },
    recentAudit: (limit) =>
      invokeUnwrapped<readonly AuditEntry[]>(bridge, 'audit:recent', { limit }),
  }
}
