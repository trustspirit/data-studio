import { describe, expect, it } from 'vitest'
import { assertRowTouched } from '@main/core/driver/capabilities/rowChangeGuard'
import type { RowChange } from '@shared/types/operation'
import { wire } from '@shared/types/wire'

const del: RowChange = { op: 'delete', pk: { id: wire.int(1) } }
const ins: RowChange = { op: 'insert', values: { id: wire.int(1) } }
const upd: RowChange = { op: 'update', pk: { id: wire.int(1) }, set: { label: wire.str('x') } }

describe('assertRowTouched', () => {
  it('0행에 닿은 delete는 실패다', () => {
    // 이게 침묵하던 데이터 유실의 핵심이다 — 지워지지 않았는데 성공으로 보고되고
    // 사용자의 대기 중 편집이 비워졌다.
    expect(() => assertRowTouched(del, 0, 0)).toThrow(/matched no rows/)
  })

  it('0행에 닿은 insert도 실패다', () => {
    expect(() => assertRowTouched(ins, 2, 0)).toThrow(/matched no rows/)
  })

  it('메시지에 몇 번째 편집인지와 종류를 담는다', () => {
    // 배치가 통째로 롤백되므로, 어느 편집이 빗나갔는지 알려 주지 않으면
    // 사용자가 원인을 찾을 수 없다.
    expect(() => assertRowTouched(del, 3, 0)).toThrow(/change 3 \(delete\)/)
  })

  it('1행 이상 닿았으면 통과한다', () => {
    expect(() => assertRowTouched(del, 0, 1)).not.toThrow()
    // PK가 유일하지 않은 테이블에서는 1보다 클 수 있고 그건 막지 않는다.
    expect(() => assertRowTouched(del, 0, 3)).not.toThrow()
  })

  it('update는 0행이어도 통과시킨다', () => {
    // MySQL의 affectedRows는 실제로 바뀐 행만 센다 — 사용자가 셀을 같은 값으로
    // 확정하는 흔한 동작이 0이 된다. 엔진별 규약을 실측하기 전에는 이것까지
    // 실패로 처리하면 정상 편집이 깨진다.
    expect(() => assertRowTouched(upd, 0, 0)).not.toThrow()
  })
})
