import type { MenuItemConstructorOptions } from 'electron'

/**
 * 애플리케이션 메뉴 템플릿.
 *
 * **이 모듈이 존재하는 이유는 `Cmd+W` 하나 때문이다.** 메뉴를 설치하지 않으면
 * Electron이 기본 메뉴를 깐다. 그 기본 메뉴의 Window 서브메뉴에는
 * `CmdOrCtrl+W`가 걸린 "Close Window"가 들어 있고, 메뉴 액셀러레이터는 renderer가
 * 아니라 **브라우저 프로세스**가 처리한다 — 즉 renderer의 `useTabShortcuts`가
 * `preventDefault()`를 해도 그 전에 창이 닫힌다. 문서 탭 하나를 닫으려던 키가
 * 모든 연결의 스테이징된 편집을 확인 없이 통째로 날린다.
 *
 * 그렇다고 `setApplicationMenu(null)`로 메뉴를 없앨 수는 없다. macOS에서는 그게
 * Cmd+Q(종료)와 Cmd+C/V/A(표준 편집 롤)까지 함께 없앤다 — 텍스트 편집이 본업인
 * 앱에서 그건 더 큰 퇴행이다. 그래서 표준 롤은 그대로 두고 **Cmd+W를 무는
 * 항목만 빼는** 템플릿을 직접 만든다.
 *
 * 빼는 방식은 "항목 자체를 넣지 않기"다. `registerAccelerator: false`도
 * 후보였지만 그 옵션은 Linux/macOS 전용이라 Windows에서는 무시된다 — 그러면
 * Windows에서 Ctrl+W가 다시 창을 닫는다. 게다가 그 옵션은 액셀러레이터를
 * *표시는 하되 동작하지 않게* 만들어, 메뉴에 죽은 단축키가 남는다. 항목을 빼면
 * 세 플랫폼에서 모두 같은 결과가 나온다.
 *
 * 같은 이유로 Cmd+W를 품은 **집합 롤**도 쓰지 않는다:
 *   - `windowMenu`  → Close Window(CmdOrCtrl+W) 포함
 *   - `fileMenu`    → macOS에서 Close(CmdOrCtrl+W) 포함
 * 두 롤 대신 필요한 항목만 손으로 나열한다.
 */
export function buildAppMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin'

  // macOS의 앱 메뉴에 Cmd+Q가 들어 있다. 다른 플랫폼에는 그 메뉴가 없으므로
  // 종료를 실어 나를 파일 메뉴를 따로 둔다(파일 롤은 mac에서 Cmd+W를 물어 못 쓴다).
  const leading: MenuItemConstructorOptions[] = isMac
    ? [{ role: 'appMenu' }]
    : [{ label: '파일', submenu: [{ role: 'quit' }] }]

  // 창 메뉴 — 표준 windowMenu 롤에서 Close Window만 뺀 것.
  const windowItems: MenuItemConstructorOptions[] = isMac
    ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    : [{ role: 'minimize' }]

  return [
    ...leading,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { label: '창', submenu: windowItems },
  ]
}
