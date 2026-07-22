import { app, BrowserWindow, ipcMain, safeStorage, session } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyWindowPolicy } from './security/windowPolicy'
import { buildCspHeader } from './security/csp'
import { createSenderGuard } from './security/senderGuard'
import { createContractRegistrar } from './ipc/registerHandler'
import { buildAppServices } from './app/compositionRoot'
import { registerIpcRoutes } from './app/ipcRoutes'
import { registerDrivers } from './app/registerDrivers'
import { consoleLogger } from './infrastructure/consoleLogger'
import { FileConnectionRepository } from './infrastructure/FileConnectionRepository'
import { FileOperationLog } from './infrastructure/execution/FileOperationLog'
import { createSecretStore } from './infrastructure/createSecretStore'
import { systemClock, systemTimers, randomId, sha256Hex } from './infrastructure/systemClock'

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

  const secrets = createSecretStore({
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
  })

  const guard = createSenderGuard(allowedRendererUrls())
  const register = createContractRegistrar({
    handle: (channel, handler) => {
      ipcMain.handle(channel, (event, input) => handler(event, input))
    },
    guard,
    logger: consoleLogger,
  })

  registerIpcRoutes(register, services)

  // 만료된 제안서를 주기적으로 버린다. 순수 팩토리는 타이머를 걸지 않으므로
  // electron 진입점인 여기서 건다.
  setInterval(() => services.sweepProposals(), PROPOSAL_SWEEP_MS)

  // 정상 종료 시 큐에 남은 감사 append를 마저 쓴다. 이게 없으면 기록 직후
  // 종료할 때 그 항목이 파일에 닿지 못한다 — 릴리스 차단 조건을 닫은 바로 그
  // 기능이 정상 종료 창에서 새는 셈이다. 크래시는 여전히 못 막지만(그건
  // append-only의 한계로 문서화됨) 정상 종료는 닫는다.
  app.on('before-quit', (event) => {
    if (auditFlushed) return
    event.preventDefault()
    void log.flush().finally(() => {
      auditFlushed = true
      app.quit()
    })
  })
}

/** before-quit 재진입 가드. flush가 끝난 뒤의 quit만 통과시킨다. */
let auditFlushed = false

void app.whenReady().then(async () => {
  installCsp()
  denyAllPermissions()
  await wireServices()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
