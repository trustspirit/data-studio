// macOS workflow smoke. Uses only a generated database/profile and mock keychain.
// This script is not included in distributable app files.
const path = require('node:path')
const os = require('node:os')
const syncFs = require('node:fs')
const { spawnSync } = require('node:child_process')
const projectRoot = path.resolve(__dirname, '..')
if (!process.versions.electron) {
  if (process.platform !== 'darwin') throw new Error('Workflow smoke currently requires macOS.')
  const scratch = syncFs.mkdtempSync(path.join(os.tmpdir(), 'datacon-workflows-'))
  const run = spawnSync(require('electron'), [__filename, scratch], { cwd: projectRoot, stdio: 'inherit', timeout: 90000 })
  if (run.status !== 0) { console.error('Workflow smoke failed; fixtures preserved at ' + scratch); process.exit(run.status ?? 1) }
  syncFs.rmSync(scratch, { recursive: true, force: true })
  process.exit(0)
}
const { app } = require('electron')
app.commandLine.appendSwitch('use-mock-keychain')
const fs = require('node:fs/promises')
const Database = require('better-sqlite3')
const root = process.argv[2]
if (!root || !path.basename(root).startsWith('datacon-workflows-')) throw new Error('A generated fixture directory is required.')
const artifacts = path.join(projectRoot, '.openai', 'ui-review')
const database = new Database(root + '/production.sqlite')
database.exec("CREATE TABLE IF NOT EXISTS orders (id integer primary key, name text, amount integer); DELETE FROM orders; INSERT INTO orders VALUES (1,'Alice',1200),(2,'Bob',2300),(3,'Carol',3400)")
app.setPath('userData', root + '/profile')
Object.defineProperty(app, 'isPackaged', { get: () => true })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const config = { id: 'production-smoke', name: 'Release validation · SQLite', engine: 'sqlite', host: '', port: 0, database: root + '/production.sqlite', username: '', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [] }
let handled = false
app.on('browser-window-created', (_event, win) => {
  if (handled) return
  handled = true
  const js = (code) => win.webContents.executeJavaScript(code)
  const wait = async (code) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      try { if (await js(code)) return } catch { /* Renderer may be navigating; retry until the deadline. */ }
      await pause(80)
    }
    throw new Error('Timed out: ' + code)
  }
  const click = (text) => js(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`)
  const input = (label, value) => js(`(() => { const element = document.querySelector('[aria-label="${label}"]'); const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`)
  win.webContents.once('did-finish-load', () => { void (async () => {
    try {
      await wait('typeof window.datacon?.invoke === "function"')
      const saved = await js(`window.datacon.invoke('connection:save', ${JSON.stringify(config)})`)
      if (!saved.ok) throw new Error('Connection save failed')
      win.webContents.reload()
      await wait('document.querySelector(\'[data-testid="connect-production-smoke"]\') !== null')
      await js('document.querySelector(\'[data-testid="connect-production-smoke"]\').click()')
      await wait('Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "main")')
      await click('main')
      await wait('document.querySelector(\'[title="main.orders"]\') !== null')
      await js('document.querySelector(\'[title="main.orders"]\').dispatchEvent(new MouseEvent("dblclick", {bubbles:true}))')
      await wait('document.querySelector(\'[role="grid"]\')?.getAttribute("aria-rowcount") === "4"')
      await input('필터 컬럼', 'name')
      await input('필터 값', 'Alice')
      await click('필터 적용')
      await wait('document.querySelector(\'[role="grid"]\')?.getAttribute("aria-rowcount") === "2"')
      await click('필터 해제')
      await wait('document.querySelector(\'[role="grid"]\')?.getAttribute("aria-rowcount") === "4"')
      await js('document.querySelectorAll(\'[role="gridcell"]\')[0].click()')
      await js('document.querySelectorAll(\'[role="gridcell"]\')[1].dispatchEvent(new MouseEvent("click", {bubbles:true, shiftKey:true}))')
      await wait('document.querySelectorAll(\'[role="gridcell"][aria-selected="true"]\').length === 2')
      const copied = await js('(() => { const data = new DataTransfer(); document.querySelector(\'[role="gridcell"]\').dispatchEvent(new ClipboardEvent("copy", {bubbles:true, clipboardData:data})); return data.getData("text/plain"); })()')
      if (copied !== '1\tAlice') throw new Error('Range copy mismatch: ' + copied)
      await js('document.querySelector(\'[data-cell][title="Alice"]\').dispatchEvent(new MouseEvent("dblclick", {bubbles:true}))')
      await js('(() => { const field = document.querySelector(\'[data-cell] input\'); field.value = "Alicia"; field.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",bubbles:true})); })()')
      await click('Save')
      await wait('document.querySelector(\'[role="dialog"]\') !== null')
      if (database.prepare('SELECT name FROM orders WHERE id=1').get().name !== 'Alice') throw new Error('Write occurred before review')
      await click('DB에 변경 적용')
      await wait('document.querySelector(\'[data-cell][title="Alicia"]\') !== null')
      if (database.prepare('SELECT name FROM orders WHERE id=1').get().name !== 'Alicia') throw new Error('Reviewed write did not reach database')
      await js('document.querySelector(\'[data-testid="doctab-new-query"]\').click()')
      await wait('document.querySelector(".cm-content") !== null')
      await js('document.querySelector(".cm-content").focus()')
      await win.webContents.insertText('SELECT id FROM orders ORDER BY id')
      await wait('document.querySelector(\'[data-testid="query-run"]\')?.disabled === false')
      await pause(300)
      await js('document.querySelector(\'[data-testid="query-run"]\').click()')
      await wait('document.body.innerText.includes("3행")')
      const secretFile = await fs.readFile(root + '/profile/secrets.json', 'utf8')
      if (secretFile.includes('SELECT id')) throw new Error('SQL saved in plaintext')
      win.webContents.reload()
      await wait('document.querySelector(\'[data-testid="connect-production-smoke"]\') !== null')
      await js('document.querySelector(\'[data-testid="connect-production-smoke"]\').click()')
      await wait('document.querySelector(".cm-content")?.innerText.includes("SELECT id FROM orders ORDER BY id")')
      await fs.mkdir(artifacts, { recursive: true })
      await fs.writeFile(path.join(artifacts, 'production-query.png'), (await win.webContents.capturePage()).toPNG())
      await js('document.querySelector(\'[data-testid="doctab-table:main.orders"]\').click()')
      await pause(300)
      await fs.writeFile(path.join(artifacts, 'production-table.png'), (await win.webContents.capturePage()).toPNG())
      console.log('PRODUCTION_UI_OK: real SQLite filter, range copy, reviewed transaction, query execution, encrypted draft and tab recovery')
      database.close()
      win.destroy()
      app.quit()
    } catch (error) { console.error(error); database.close(); app.exit(1) }
  })() })
})
setTimeout(() => { console.error('Production UI check timed out'); app.exit(1) }, 90000)
require(path.join(projectRoot, 'dist', 'main', 'index.js'))
