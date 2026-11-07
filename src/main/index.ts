import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session } from 'electron'
import type { OpenDialogOptions } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyWindowPolicy } from './security/windowPolicy'
import { buildCspHeader } from './security/csp'
import { createSenderGuard } from './security/senderGuard'
import { createContractRegistrar } from './ipc/registerHandler'
import { buildAppServices } from './app/compositionRoot'
import { registerIpcRoutes } from './app/ipcRoutes'
import { registerDrivers } from './app/registerDrivers'
import { buildAppMenuTemplate } from './app/appMenu'
import { consoleLogger } from './infrastructure/consoleLogger'
import { FileConnectionRepository } from './infrastructure/FileConnectionRepository'
import { FileOperationLog } from './infrastructure/execution/FileOperationLog'
import { createAsyncSecretStore } from './infrastructure/createSecretStore'
import { systemClock, systemTimers, randomId, sha256Hex } from './infrastructure/systemClock'
import { maybeRunSqliteSmoke } from './smoke'

// 게이트된 SQLite 네이티브 스모크. `--datacon-smoke-sqlite`가 있으면 GUI/서비스
// 초기화 전에 :memory: DB를 열어 검증하고 프로세스를 종료한다(동기). 플래그가
// 없으면 no-op이라 프로덕션 실행 경로에 영향이 없다.
maybeRunSqliteSmoke()

/** 만료된 쓰기 제안서를 이 간격으로 버린다. 문장 원문을 오래 들고 있지 않기 위해서. */
const PROPOSAL_SWEEP_MS = 60_000

const DEV_SERVER_URL = 'http://localhost:5173/'
const isDev = !app.isPackaged

function rendererIndexPath(): string {
  return path.join(__dirname, '..', 'renderer', 'index.html')
}

/** renderer가 머물러도 되는 정확한 URL. sender 검증에도 같은 값을 쓴다. */
export function allowedRendererUrls(): readonly string[] {
  return isDev ? [DEV_SERVER_URL] : [pathToFileURL(rendererIndexPath()).href]
}

/**
 * CSP 헤더 경로. **dev 전용이라고 봐야 한다.**
 *
 * 패키징된 앱은 renderer를 file://로 여는데 webRequest는 file:// 를 가로채지
 * 않는다 — 즉 이 핸들러는 사용자가 실제로 돌리는 빌드에서 한 번도 불리지
 * 않는다. 프로덕션 정책은 빌드 시 index.html에 주입되는 meta 태그가 나른다
 * (vite.config.ts의 cspMetaPlugin → security/csp.ts의 injectCspMeta, 같은
 * buildCspHeader에서 파생하므로 두 경로가 갈라지지 않는다).
 *
 * 그럼에도 헤더를 남겨 두는 이유: dev 서버 응답에는 헤더가 확실하고, 훗날
 * http(s)를 타는 로드가 생기면 그 경로도 정책을 받게 하기 위해서다.
 */
function installCsp(): void {
  const header = buildCspHeader(isDev)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [header],
      },
    })
  })
}

/**
 * Electron 기본값은 여러 권한 요청을 허용한다. 이 앱은 카메라·마이크·위치·알림
 * 어느 것도 쓰지 않으므로 전부 거부한다. 필요해지는 권한이 생기면 그때
 * 개별적으로 열어야 한다.
 */
function denyAllPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
}

/**
 * 창 정책을 창 생성 시점이 아니라 webContents 생성 시점에 건다.
 * createWindow() 안에서만 걸면 다른 경로로 만들어진 webContents가 정책을
 * 건너뛴다.
 */
function installGlobalWindowPolicy(): void {
  app.on('web-contents-created', (_event, contents) => {
    applyWindowPolicy({ webContents: contents }, { allowedUrls: allowedRendererUrls() })
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question', buttons: ['계속 편집', '변경 버리고 닫기'], defaultId: 0, cancelId: 0,
      title: '저장하지 않은 작업', message: '저장 중인 SQL 또는 DB에 적용하지 않은 편집이 있습니다.', detail: '계속 편집을 선택하면 저장 상태를 확인할 수 있습니다. 지금 닫으면 저장되지 않은 작업이 사라질 수 있습니다.',
    })
    if (choice === 1) event.preventDefault()
  })

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(rendererIndexPath())
  }

  return window
}

// 창이 만들어지기 전에 등록해야 첫 창의 webContents도 정책을 받는다.
installGlobalWindowPolicy()

/**
 * 실행 스택을 조립하고 IPC 라우트를 등록한다.
 *
 * 조립·라우팅 로직은 전부 테스트된 `buildAppServices`/`registerIpcRoutes`에 있다.
 * 이 함수는 electron 고유의 배선(경로·safeStorage·ipcMain·senderGuard)만 담당한다.
 */
async function wireServices(): Promise<void> {
  const userData = app.getPath('userData')

  const log = await FileOperationLog.create(
    path.join(userData, 'audit.jsonl'),
    systemClock,
    consoleLogger,
  )

  const secrets = await createAsyncSecretStore({
    safeStorage,
    filePath: path.join(userData, 'secrets.json'),
    platform: process.platform,
    logger: consoleLogger,
  })

  const services = buildAppServices({
    logger: consoleLogger,
    repository: new FileConnectionRepository(path.join(userData, 'connections.json'), consoleLogger),
    secrets,
    log,
    clock: systemTimers,
    randomId,
    hash: sha256Hex,
    pool: { maxConcurrent: 4, queueTimeoutMs: 30_000 },
    registerDrivers: (registry) => registerDrivers(registry, { secrets }),
    streamPush: (subscriptionId, batch) => {
      // push 시점에 현재 윈도우를 조회한다 — wireServices가 창 생성보다 먼저여도 되고,
      // 창이 닫히는 중이면 조용히 버린다(단일 윈도우 가정).
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('stream:message', { subscriptionId, batch })
    },
    aiPush: (sessionId, event) => {
      const win = BrowserWindow.getAllWindows()[0]
      // 페이로드에서는 chatId — renderer가 보는 세션 핸들 이름이다(aiEvents.ts).
      win?.webContents.send('ai:event', { chatId: sessionId, event })
    },
    fileDialog: {
      openFile: async () => {
        const win = BrowserWindow.getFocusedWindow()
        const options: OpenDialogOptions = {
          properties: ['openFile'],
          filters: [
            { name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null)
      },
    },
  })

  const guard = createSenderGuard(allowedRendererUrls())
  const register = createContractRegistrar({
    handle: (channel, handler) => {
      ipcMain.handle(channel, (event, input) => handler(event, input))
    },
    guard,
    logger: consoleLogger,
  })

  const flushWorkspace = registerIpcRoutes(register, services)

  // 만료된 제안서를 주기적으로 버린다. 순수 팩토리는 타이머를 걸지 않으므로
  // electron 진입점인 여기서 건다.
  setInterval(() => services.sweepProposals(), PROPOSAL_SWEEP_MS)

  // 정상 종료 시 큐에 남은 감사 append를 마저 쓴다. 이게 없으면 기록 직후
  // 종료할 때 그 항목이 파일에 닿지 못한다 — 릴리스 차단 조건을 닫은 바로 그
  // 기능이 정상 종료 창에서 새는 셈이다. 크래시는 여전히 못 막지만(그건
  // append-only의 한계로 문서화됨) 정상 종료는 닫는다.
  app.on('will-quit', (event) => {
    if (auditFlushed) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    services.executor.cancelAll()
    services.ai.closeAll()
    void Promise.allSettled([services.streamHub.closeAll(), services.connections.closeAll(), flushWorkspace()]).then((results) => {
      if (results.some((result) => result.status === 'rejected')) consoleLogger.warn('shutdown.cleanup_failed', {})
    }).finally(() =>
      log.flush().finally(() => {
        auditFlushed = true
        app.quit()
      }),
    )
  })
}

/** before-quit 재진입 가드. flush가 끝난 뒤의 quit만 통과시킨다. */
let auditFlushed = false
let shuttingDown = false

void app.whenReady().then(async () => {
  // 창을 만들기 전에 깐다. 메뉴를 직접 깔지 않으면 Electron이 기본 메뉴를
  // 설치하고, 그 Window 서브메뉴의 CmdOrCtrl+W가 renderer의 탭 닫기 단축키보다
  // 먼저 창을 닫아 버린다(브라우저 프로세스가 처리하므로 renderer의
  // preventDefault로는 막을 수 없다). 자세한 사정은 appMenu.ts 주석에.
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(process.platform)))
  installCsp()
  denyAllPermissions()
  await wireServices()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch(() => {
  dialog.showErrorBox('Database Studio 시작 실패', '로컬 설정 또는 암호화 저장소를 열지 못했습니다. 파일 접근 권한을 확인한 뒤 다시 시작하세요. 기존 파일은 삭제하지 않았습니다.')
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
