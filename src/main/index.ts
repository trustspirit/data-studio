import { app, BrowserWindow, session } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyWindowPolicy } from './security/windowPolicy'
import { buildCspHeader } from './security/csp'

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

void app.whenReady().then(() => {
  installCsp()
  denyAllPermissions()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
