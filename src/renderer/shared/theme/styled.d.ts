import 'styled-components'
import type { AppTheme } from './darkTheme'

// styled-components의 DefaultTheme을 우리 토큰 구조로 보강한다.
// 이걸로 `${({ theme }) => theme.color.x}`가 타입 검사를 받는다.
declare module 'styled-components' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefaultTheme extends AppTheme {}
}
