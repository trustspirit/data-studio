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

  applyWindowPolicy(window, { allowedUrls: allowedRendererUrls() })

  window.once('ready-to-show', () => window.show())

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(rendererIndexPath())
  }

  return window
}

void app.whenReady().then(() => {
  installCsp()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
