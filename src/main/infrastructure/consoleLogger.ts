import type { Logger } from '../core/ports/Logger'

/**
 * main 프로세스 로거. 이벤트 이름과 구조화된 detail을 stderr로 낸다.
 *
 * renderer로는 아무것도 보내지 않는다 — 로그에는 커넥션 문자열·파일 경로·오류
 * 원문이 섞일 수 있고, 그건 main 안에만 있어야 한다.
 */
export const consoleLogger: Logger = {
  warn(event, detail) {
    console.warn(`[${event}]`, JSON.stringify(detail))
  },
}
