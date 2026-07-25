import type { AiEventPayload } from '../../../shared/contracts/aiEvents'
import type {
  AiGateway,
  AiKeyStatus,
  AiProposal,
  AiSendOutcome,
} from '../ports/AiGateway'
import { invokeUnwrapped, type DataconBridge } from './ipcInvoke'

/** `window.datacon.invoke`/`on`을 감싸는 AI 게이트웨이. */
export function createIpcAiGateway(bridge: DataconBridge): AiGateway {
  return {
    newSession: (provider) =>
      invokeUnwrapped<{ chatId: string }>(bridge, 'ai:newSession', { provider }),
    send: (chatId, text) => invokeUnwrapped<AiSendOutcome>(bridge, 'ai:send', { chatId, text }),
    cancel: async (chatId) => {
      await invokeUnwrapped<null>(bridge, 'ai:cancel', { chatId })
    },
    keyStatus: () => invokeUnwrapped<AiKeyStatus>(bridge, 'ai:keyStatus', undefined),
    setKey: async (provider, value) => {
      await invokeUnwrapped<null>(bridge, 'ai:setKey', { provider, value })
    },
    deleteKey: async (provider) => {
      await invokeUnwrapped<null>(bridge, 'ai:deleteKey', { provider })
    },
    proposals: (connectionId) =>
      invokeUnwrapped<readonly AiProposal[]>(bridge, 'ai:proposals', { connectionId }),
    rejectProposal: async (proposalId, connectionId) => {
      const r = await invokeUnwrapped<{ rejected: boolean }>(bridge, 'ai:rejectProposal', {
        proposalId,
        connectionId,
      })
      return r.rejected
    },
    onEvent: (chatId, listener) =>
      bridge.on('ai:event', (payload) => {
        const msg = payload as AiEventPayload
        if (msg.chatId === chatId) listener(msg.event)
      }),
  }
}
