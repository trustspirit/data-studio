// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStreamTopics } from '@renderer/features/streams/model/useStreamTopics'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import type { WireValue } from '@shared/types/wire'

function gateway(topics: string[]): OperationGateway {
  return {
    run: () => Promise.resolve({
      ok: true,
      payload: {
        kind: 'rows',
        rows: {
          requestId: 'r', columns: [{ name: 'topic', type: 'str' }],
          rows: topics.map((t): readonly WireValue[] => [{ t: 'str', v: t }]),
          page: { cursor: null, hasMore: false, rowCount: topics.length, bytes: 0 },
          meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
        },
      },
    }),
    onStreamMessage: () => () => {},
  } as unknown as OperationGateway
}

describe('useStreamTopics', () => {
  it('listTopics 결과를 토픽 목록으로 노출한다', async () => {
    const { result } = renderHook(() => useStreamTopics(gateway(['orders', 'events']), 'c1'))
    await waitFor(() => expect(result.current.topics).toEqual(['orders', 'events']))
  })
})
