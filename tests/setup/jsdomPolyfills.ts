/**
 * jsdom은 `Range.prototype.getClientRects`/`getBoundingClientRect`를 구현하지 않는다
 * (https://github.com/jsdom/jsdom/issues/3729). CodeMirror의 비동기 `measure()`가
 * requestAnimationFrame 콜백 안에서 이걸 부르는데, 콜백이 테스트 종료(언마운트) 뒤
 * 시점에 걸리면 `TypeError: textRange(...).getClientRects is not a function`가
 * 테스트 경계를 넘어 "unhandled error"로 새어나가 `npm test`를 간헐적으로 실패시킨다
 * (CodeMirror를 마운트하는 테스트 파일 수가 늘수록 재현율이 올라간다 — 여러 곳에서
 * rAF가 겹치기 때문).
 *
 * 실제 텍스트 측정값은 테스트에서 의미가 없으므로(가짜 레이아웃), 빈 사각형을 주는
 * 것으로 충분하다 — jsdom 환경에서만, 그리고 아직 없을 때만 채워 넣는다.
 */
if (typeof Range !== 'undefined') {
  const emptyRect = (): DOMRect => ({
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON() {
      return {}
    },
  })

  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = function (): DOMRectList {
      return [] as unknown as DOMRectList
    }
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = function (): DOMRect {
      return emptyRect()
    }
  }
}
