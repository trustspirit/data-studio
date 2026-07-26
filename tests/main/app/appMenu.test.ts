import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildAppMenuTemplate } from '@main/app/appMenu'

const PLATFORMS: NodeJS.Platform[] = ['darwin', 'win32', 'linux']

/** 템플릿 트리를 평평하게 편다 — 액셀러레이터는 서브메뉴 깊은 곳에 숨는다. */
function flatten(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => {
    const submenu = item.submenu
    const children = Array.isArray(submenu) ? flatten(submenu) : []
    return [item, ...children]
  })
}

function roles(template: readonly MenuItemConstructorOptions[]): string[] {
  return flatten(template)
    .map((i) => i.role)
    .filter((r): r is NonNullable<MenuItemConstructorOptions['role']> => r !== undefined)
}

/**
 * 이 롤들은 자기 자신이 CmdOrCtrl+W를 물거나(close), 그것을 품은 서브메뉴를
 * 통째로 펼친다(windowMenu는 Close Window를, macOS의 fileMenu는 Close를 낸다).
 * 롤이 내는 항목은 템플릿에 문자열로 드러나지 않으므로 롤 이름으로 막는다.
 */
const ROLES_THAT_BIND_CLOSE = new Set(['close', 'windowMenu', 'fileMenu'])

/** `Cmd+W`/`CmdOrCtrl+W`/`Ctrl+W`… 어떤 표기든 잡는다. */
const CLOSE_ACCELERATOR = /^(cmdorctrl|commandorcontrol|cmd|command|ctrl|control|super)\+w$/i

describe('애플리케이션 메뉴 템플릿', () => {
  // 이 앱에서 Cmd+W는 "문서 탭 닫기"다. 메뉴가 같은 키에 "창 닫기"를 걸면
  // 브라우저 프로세스가 그 키를 먼저 먹고 창을 닫는다 — renderer의
  // preventDefault는 실행될 기회조차 없고, 모든 연결의 스테이징된 편집이
  // 확인 없이 사라진다. 이 브랜치가 ConfirmDialog로 막으려던 바로 그 손실이다.
  it.each(PLATFORMS)('%s: Cmd+W를 무는 항목이 어디에도 없다', (platform) => {
    const template = buildAppMenuTemplate(platform)

    const explicit = flatten(template).filter(
      (i) => typeof i.accelerator === 'string' && CLOSE_ACCELERATOR.test(i.accelerator),
    )
    expect(explicit).toEqual([])

    const implicit = roles(template).filter((r) => ROLES_THAT_BIND_CLOSE.has(r))
    expect(implicit).toEqual([])
  })

  // 메뉴를 통째로 없애는 것(setApplicationMenu(null))도 Cmd+W를 막기는 한다 —
  // 대신 macOS에서 Cmd+Q와 표준 편집 롤(복사/붙여넣기/전체선택)까지 함께
  // 사라진다. 그 "해법"으로 되돌아가는 것을 막는 단언이다.
  it.each(PLATFORMS)('%s: 표준 편집 롤과 종료 경로는 그대로 남는다', (platform) => {
    const all = roles(buildAppMenuTemplate(platform))
    expect(all).toContain('editMenu')
    // 종료: macOS는 앱 메뉴가 Cmd+Q를 들고 있고, 그 외 플랫폼은 quit 롤을 직접 낸다.
    expect(all.includes('appMenu') || all.includes('quit')).toBe(true)
  })

  it('macOS 앱 메뉴는 darwin에서만 나온다', () => {
    expect(roles(buildAppMenuTemplate('darwin'))).toContain('appMenu')
    expect(roles(buildAppMenuTemplate('win32'))).not.toContain('appMenu')
    expect(roles(buildAppMenuTemplate('linux'))).not.toContain('appMenu')
  })

  it('창 메뉴는 남되 최소화만 담는다', () => {
    // 창 메뉴 자체가 사라지면 Cmd+W는 막히지만 사용자는 최소화를 잃는다.
    const mac = buildAppMenuTemplate('darwin')
    expect(roles(mac)).toContain('minimize')
    expect(roles(buildAppMenuTemplate('win32'))).toContain('minimize')
    expect(mac.some((i) => i.label === '창')).toBe(true)
  })
})
