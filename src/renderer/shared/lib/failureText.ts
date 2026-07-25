/**
 * 실패 결과를 화면에 쓸 한 줄로 만든다.
 *
 * main은 실패를 두 층으로 준다: 닫힌 코드(`reason`)와, 사용자 실행이 엔진
 * 오류로 깨졌을 때만 실리는 원문(`detail`). 원문이 있으면 그것이 늘 더 유용하다
 * — `error` 한 단어와 `relation "users" does not exist`의 차이다.
 *
 * 코드를 한국어로 번역하지 않는 이유는, 매핑 표가 코드가 늘 때마다 낡고
 * 빠뜨린 코드는 빈 화면이 되기 때문이다. 코드는 그대로 보여준다.
 */
export function failureText(outcome: {
  readonly reason: string
  readonly detail?: string
}): string {
  const { detail, reason } = outcome
  return detail !== undefined && detail.trim() !== '' ? detail : reason
}
