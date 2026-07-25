import type { ResultSet } from '@shared/types/resultSet'
import { estimateWireBytes, wire, type WireValue } from '@shared/types/wire'

export interface PiiRedactor {
  /**
   * 컬럼명이 patterns 중 하나에 (대소문자 무시 부분 문자열) 매칭되면 그 컬럼의
   * 모든 셀 값을 마스킹하고, 전체 결과를 maxBytes 이내로 자른다.
   */
  redact(rs: ResultSet, patterns: readonly string[], maxBytes: number): ResultSet
}

const MASK: WireValue = wire.str('***')

export class DefaultPiiRedactor implements PiiRedactor {
  redact(rs: ResultSet, patterns: readonly string[], maxBytes: number): ResultSet {
    const lowered = patterns.map((p) => p.toLowerCase())
    const maskCol = rs.columns.map((c) => {
      const name = c.name.toLowerCase()
      return lowered.some((p) => p !== '' && name.includes(p))
    })

    const kept: (readonly WireValue[])[] = []
    let bytes = 0
    let truncatedBytes = false
    for (const row of rs.rows) {
      const masked = row.map((v, i) => (maskCol[i] === true ? MASK : v))
      const rowBytes = masked.reduce((sum, v) => sum + estimateWireBytes(v), 0)
      // 첫 행은 상한을 넘어도 담는다 — 한 행도 못 주면 호출자가 아무것도 못 본다.
      if (kept.length > 0 && bytes + rowBytes > maxBytes) {
        truncatedBytes = true
        break
      }
      kept.push(masked)
      bytes += rowBytes
      if (bytes > maxBytes) {
        truncatedBytes = true
        break
      }
    }

    return {
      ...rs,
      rows: kept,
      page: { ...rs.page, rowCount: kept.length, hasMore: rs.page.hasMore || truncatedBytes },
      meta: { ...rs.meta, truncatedBytes: rs.meta.truncatedBytes || truncatedBytes },
    }
  }
}
