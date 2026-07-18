/**
 * IPC 호출이 어디서 왔는지를 나타낸다. **절대 renderer 입력에서 파생되지 않는다** —
 * registerHandler가 main 프로세스 상태만으로 구성해 핸들러에 주입한다.
 *
 * 다음 단계에서 AI 어시스턴트가 직접 커맨드를 발행하게 되면 실행 게이트가
 * "사람 UI에서 온 호출인지 AI에서 온 호출인지"를 구분해야 한다. CallerSource를
 * 여기서 유니온으로 넓히기만 하면 되고, 호출부(register 시그니처)는 바뀌지 않는다.
 */
export type CallerSource = 'renderer-ui'

export interface CallerContext {
  readonly source: CallerSource
}
