import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient, DbClient } from './db'
import { deleteSaved, listSaved, saveConnection } from './store'
import { exportRows, ExportFormat } from './export'
import { openTunnel, Tunnel } from './tunnel'
import { readImportFile } from './importer'
import { installCrashLog, openLogFolder, writeLog } from './log'
import * as ai from './ai'
import { sampleDatabase } from './sample'
import { checkForUpdate, clearLicence, getLicence, readTeam, setLicence, shareToTeam } from './product'
import { deleteSchedule, listSchedules, runSchedule, saveSchedule, startScheduler } from './scheduler'
import { driverFor } from '../shared/drivers'
import type { TeamData, Schedule, AiRequest, ConnectionConfig, PageOptions, RowChange, RowUpdate, SavedConnection, TableInfo, TxAction } from '../shared/types'

// Keep using the data folder from an earlier app name (DB Studio, Datahive), so saved connections stay.
const oldData = ['DB Studio', 'Datahive', 'datahive'].map((n) => path.join(app.getPath('appData'), n)).find((d) => fs.existsSync(d))
if (oldData && !fs.existsSync(path.join(app.getPath('appData'), 'Qubase'))) app.setPath('userData', oldData)

installCrashLog()

// Open connections live only in the main process; the UI refers to them by id.
const clients = new Map<string, DbClient>()
// Config each connection was opened with, so we can reconnect to another database.
const configs = new Map<string, ConnectionConfig>()

function getClient(id: string): DbClient {
  const client = clients.get(id)
  if (!client) throw new Error('Connection is closed')
  return client
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    title: 'Qubase',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // Closing the window first asks the page, which checks for unsaved query tabs.
  // If the page has crashed or doesn't answer within 4 s, the window closes anyway.
  let closeOk = false
  win.on('close', (e) => {
    if (closeOk || win.webContents.isCrashed() || win.webContents.isLoading()) return
    e.preventDefault()
    win.webContents.send('app:closeRequest')
    const t = setTimeout(() => { if (!answered) { closeOk = true; win.close() } }, 4000)
    let answered = false
    const busy = () => { answered = true; clearTimeout(t) }
    ipcMain.once('app:closeSeen', busy)
  })
  ipcMain.on('app:closeOk', (e) => { if (e.sender === win.webContents) { closeOk = true; win.close() } })
  // Links (e.g. in notebook notes) open in the system browser, never in the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {

    const dev = process.env.VITE_DEV_SERVER_URL

    if (!url.startsWith('file:') && !(dev && url.startsWith(dev))) e.preventDefault()

  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
}

// SSH tunnels by main connection id; query tabs reuse their parent's tunnel
const tunnels = new Map<string, Tunnel>()

/** Open the SSH tunnel if the connection uses one; returns the config to connect with. */
async function withTunnel(config: ConnectionConfig): Promise<{ config: ConnectionConfig; tunnel?: Tunnel }> {
  if (!config.ssh?.enabled) return { config }
  const tunnel = await openTunnel(config)
  return { config: tunnel.config, tunnel }
}

ipcMain.handle('db:connect', async (_e, raw: ConnectionConfig) => {
  const { config, tunnel } = await withTunnel(raw)
  const client = createClient(config)
  try { await client.connect() } catch (e) { tunnel?.close(); throw e }
  const id = randomUUID()
  clients.set(id, client)
  configs.set(id, config)
  if (tunnel) tunnels.set(id, tunnel)
  return { id, canEdit: client.canEdit }
})
ipcMain.handle('db:listDatabases', async (_e, id: string) => {
  const client = getClient(id)
  return client.listDatabases ? client.listDatabases() : null
})
/** Open a new connection to another database on the same server, then swap it in. */
async function switchOne(id: string, database: string) {
  const config = { ...configs.get(id)!, database, url: undefined }
  const next = createClient(config)
  await next.connect()
  const old = clients.get(id)
  clients.set(id, next)
  configs.set(id, config)
  await old?.disconnect().catch(() => {})
}
ipcMain.handle('db:switchDatabase', async (_e, id: string, database: string) => {
  await switchOne(id, database)
  // Query tabs follow the sidebar's database
  await Promise.all([...(children.get(id) ?? [])].map((c) => switchOne(c, database)))
})

// Each query tab gets its own connection (like SSMS), so a long query in one
// tab doesn't block the others. File databases share the main connection.
const children = new Map<string, Set<string>>()
const SHARED_ENGINES = new Set(['sqlite', 'duckdb', 'libsql'])
ipcMain.handle('db:openSession', async (_e, parentId: string) => {
  const config = configs.get(parentId)
  if (!config) throw new Error('Connection is closed')
  if (SHARED_ENGINES.has(driverFor(config.kind).engine)) return parentId
  // One real connection per tab, so BEGIN / COMMIT stay on the same connection
  const client = createClient({ ...config, session: true })
  await client.connect()
  const id = randomUUID()
  clients.set(id, client)
  configs.set(id, config)
  if (!children.has(parentId)) children.set(parentId, new Set())
  children.get(parentId)!.add(id)
  return id
})
ipcMain.handle('db:closeSession', async (_e, parentId: string, id: string) => {
  if (id === parentId) return
  children.get(parentId)?.delete(id)
  await clients.get(id)?.disconnect().catch(() => {})
  clients.delete(id)
  configs.delete(id)
})
/** Line (1-based) in the script where the database says the error is, if it says. */
function errorLine(e: unknown, sql: string): number | undefined {
  const x = e as { lineNumber?: number; position?: string | number; message?: string }
  if (typeof x?.lineNumber === 'number' && x.lineNumber > 0) return x.lineNumber // SQL Server
  if (x?.position !== undefined && Number(x.position) > 0) return sql.slice(0, Number(x.position) - 1).split('\n').length // PostgreSQL
  const m = /\bat line (\d+)/i.exec(x?.message ?? '') // MySQL
  return m ? Number(m[1]) : undefined
}
ipcMain.handle('db:queryMulti', async (_e, id: string, sql: string, maxRows = 0) => {
  const client = getClient(id)
  try {
    if (client.queryMulti) return await client.queryMulti(sql, maxRows)
    const r = await client.query(sql)
    if (maxRows > 0 && r.rows.length > maxRows) return [{ ...r, rows: r.rows.slice(0, maxRows), rowCount: maxRows, truncated: true }]
    return [r]
  } catch (e) {
    // The error line travels at the end of the message after \u0001; the UI strips it.
    const line = errorLine(e, sql)
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(line ? `${msg}\u0001${line}` : msg)
  }
})
ipcMain.handle('db:selectPage', async (_e, id: string, t: TableInfo, o: PageOptions) => {
  const c = getClient(id)
  if (c.selectPage) return c.selectPage(t, o)
  // No server paging (MongoDB, Redis): read up to the end of the page and slice it
  const r = await c.selectTop(t, Math.min(50000, o.offset + o.limit))
  return { ...r, rows: r.rows.slice(o.offset), rowCount: Math.max(0, r.rows.length - o.offset), total: null }
})
ipcMain.handle('db:explain', async (_e, id: string, sql: string) => {
  const c = getClient(id)
  if (!c.explain) throw new Error('Query plans are not available for this database')
  return c.explain(sql)
})
ipcMain.handle('db:transaction', async (_e, id: string, action: TxAction) => {
  const c = getClient(id)
  if (!c.transactionControl) throw new Error('Transactions are not available for this database')
  return c.transactionControl(action)
})
ipcMain.handle('import:read', (_e, file: string) => readImportFile(file))
ipcMain.handle('ai:ask', (_e, req: AiRequest) => ai.ask(req))
ipcMain.handle('ai:hasKey', () => ai.hasKey())
ipcMain.handle('ai:setKey', (_e, key: string, model: string) => ai.setKey(key, model))
ipcMain.handle('ai:getConfig', () => ai.getConfig())
// Streaming chat: pieces of the answer go back as 'ai:chunk' events; the call settles when the answer ends
ipcMain.handle('ai:chat', (e, id: string, req: ai.ChatRequest) => ai.chat(id, req, (t) => { if (!e.sender.isDestroyed()) e.sender.send('ai:chunk', id, t) }))
ipcMain.handle('ai:stop', (_e, id: string) => ai.stopChat(id))
ipcMain.handle('ai:setConfig', (_e, c) => ai.setConfig(c))
ipcMain.handle('ai:test', (_e, c) => ai.test(c))
ipcMain.handle('ai:listModels', (_e, c) => ai.listModels(c))
ipcMain.handle('log:error', (_e, text: string) => writeLog('renderer', String(text).slice(0, 20000)))
ipcMain.handle('log:open', () => openLogFolder())
/** Stop a running query. Drivers without a cancel call get a fresh connection instead. */
ipcMain.handle('db:cancel', async (_e, id: string) => {
  const client = getClient(id)
  if (client.cancel) return client.cancel()
  const config = configs.get(id)
  if (!config) return
  const old = clients.get(id)
  const next = createClient(config)
  clients.set(id, next)
  await old?.disconnect().catch(() => {})
  await next.connect()
})

// Export a result grid to CSV, Excel or JSON
const EXT: Record<ExportFormat, string> = { csv: 'csv', excel: 'xlsx', json: 'json', sql: 'sql', markdown: 'md', html: 'html' }
ipcMain.handle('export:save', async (e, data: { columns: string[]; rows: Record<string, unknown>[] }, format: ExportFormat, name: string, table?: string, engine?: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const ext = EXT[format]
  const r = await dialog.showSaveDialog(win, {
    defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }]
  })
  if (r.canceled || !r.filePath) return null
  await exportRows(data, format, r.filePath, table, engine)
  return r.filePath
})
ipcMain.handle('db:test', async (_e, raw: ConnectionConfig) => {
  const { config, tunnel } = await withTunnel(raw)
  try {
    const client = createClient(config)
    await client.connect()
    await client.disconnect()
  } finally { tunnel?.close() }
})
ipcMain.handle('db:disconnect', async (_e, id: string) => {
  for (const c of children.get(id) ?? []) {
    await clients.get(c)?.disconnect().catch(() => {})
    clients.delete(c); configs.delete(c)
  }
  children.delete(id)
  await clients.get(id)?.disconnect().catch(() => {})
  clients.delete(id)
  configs.delete(id)
  tunnels.get(id)?.close()
  tunnels.delete(id)
})
ipcMain.handle('db:listTables', (_e, id: string) => getClient(id).listTables())
ipcMain.handle('db:listColumns', (_e, id: string, t: TableInfo) => getClient(id).listColumns(t))
ipcMain.handle('db:query', (_e, id: string, sql: string) => getClient(id).query(sql))
ipcMain.handle('db:selectTop', (_e, id: string, t: TableInfo, limit: number) => getClient(id).selectTop(t, limit))
ipcMain.handle('db:listObjects', async (_e, id: string) => {
  const c = getClient(id)
  return c.listObjects ? c.listObjects() : []
})
ipcMain.handle('db:getDefinition', async (_e, id: string, target: Parameters<NonNullable<DbClient['getDefinition']>>[0]) => {
  const c = getClient(id)
  if (!c.getDefinition) throw new Error('Scripts are not available for this database')
  return c.getDefinition(target)
})
ipcMain.handle('db:getStructure', async (_e, id: string, t: TableInfo) => {
  const c = getClient(id)
  if (c.getStructure) return c.getStructure(t)
  return { columns: await c.listColumns(t), indexes: [], foreignKeys: [], triggers: [] }
})
ipcMain.handle('db:applyChanges', async (_e, id: string, ch: RowChange[]) => {
  const c = getClient(id)
  if (c.applyChanges) return c.applyChanges(ch)
  if (ch.some((x) => x.op !== 'update')) throw new Error('Adding and deleting rows is not supported for this database')
  return c.applyUpdates(ch.map((x) => x as Extract<RowChange, { op: 'update' }>))
})
ipcMain.handle('db:applyUpdates', (_e, id: string, u: RowUpdate[]) => getClient(id).applyUpdates(u))

ipcMain.handle('store:list', () => listSaved())
ipcMain.handle('store:save', (_e, c: SavedConnection) => saveConnection(c))
ipcMain.handle('store:delete', (_e, id: string) => deleteSaved(id))

ipcMain.handle('app:sampleDb', () => sampleDatabase())

ipcMain.handle('dialog:pickFile', async (e, kind: 'db' | 'any' | 'data' = 'db') => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const filters = kind === 'db'
    ? [{ name: 'Databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3', 'duckdb', 'ddb'] }, { name: 'All files', extensions: ['*'] }]
    : kind === 'data'
      ? [{ name: 'Data files', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'json'] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'All files', extensions: ['*'] }]
  const r = await dialog.showOpenDialog(win, {
    properties: kind === 'db' ? ['openFile', 'promptToCreate'] : ['openFile'],
    filters
  })
  return r.canceled ? null : r.filePaths[0]
})

// Scheduled queries
ipcMain.handle('schedules:list', () => listSchedules())
ipcMain.handle('schedules:save', (_e, s: Schedule) => saveSchedule(s))
ipcMain.handle('schedules:delete', (_e, id: string) => deleteSchedule(id))
ipcMain.handle('schedules:run', (_e, id: string) => runSchedule(id))
ipcMain.handle('schedules:reveal', (_e, id: string) => {
  // Only files the scheduler wrote itself
  const f = listSchedules().find((s) => s.id === id)?.history?.find((h) => h.file)?.file
  if (f && fs.existsSync(f)) shell.showItemInFolder(f)
})
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:checkUpdate', (_e, url: string) => checkForUpdate(url))
ipcMain.handle('licence:get', () => getLicence())
ipcMain.handle('licence:set', (_e, key: string) => setLicence(key))
ipcMain.handle('licence:clear', () => clearLicence())
ipcMain.handle('team:read', (_e, folder: string) => readTeam(folder))
ipcMain.handle('team:share', (_e, folder: string, data: Partial<TeamData>) => shareToTeam(folder, data))
ipcMain.handle('dialog:pickFolder', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

// Notebooks and other text files the user saves or opens
ipcMain.handle('file:saveText', async (e, content: string, o: { name: string; filter: string; ext: string; path?: string }) => {
  let file = o.path
  if (!file) {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { defaultPath: `${o.name}.${o.ext}`, filters: [{ name: o.filter, extensions: [o.ext] }] })
    if (r.canceled || !r.filePath) return null
    file = r.filePath
  }
  await fs.promises.writeFile(file, content, 'utf8')
  return file
})
ipcMain.handle('file:saveBinary', async (e, b64: string, o: { name: string; filter: string; ext: string }) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { defaultPath: `${o.name}.${o.ext}`, filters: [{ name: o.filter, extensions: [o.ext] }] })
  if (r.canceled || !r.filePath) return null
  await fs.promises.writeFile(r.filePath, Buffer.from(b64, 'base64'))
  return r.filePath
})
ipcMain.handle('file:svgPdf', async (e, svg: string, o: { name: string; width: number; height: number }) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { defaultPath: `${o.name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (r.canceled || !r.filePath) return null
  // Draw the SVG in a hidden window (no scripts, no network) and print it to one page of exactly its size
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  let tmp = ''
  try {
    // PDF pages top out at 200 inches; shrink very large diagrams to fit (it's vector, so it stays sharp)
    const k = Math.min(1, 19000 / Math.max(o.width, o.height))
    const W = Math.ceil(o.width * k), H = Math.ceil(o.height * k)
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${W}px ${H}px;margin:0}html,body{margin:0}body>svg{width:${W}px;height:${H}px;display:block}</style></head><body>${svg}</body></html>`
    // Big diagrams are several MB, over Chromium's 2 MB URL limit, so load from a temp file instead of a data: URL
    tmp = path.join(app.getPath('temp'), `qubase-pdf-${randomUUID()}.html`)
    await fs.promises.writeFile(tmp, html, 'utf8')
    await w.loadFile(tmp)
    const pdf = await w.webContents.printToPDF({ printBackground: true, margins: { marginType: 'none' }, pageSize: { width: W / 96, height: H / 96 }, preferCSSPageSize: true })
    await fs.promises.writeFile(r.filePath, pdf)
    return r.filePath
  } finally { w.destroy(); if (tmp) fs.promises.unlink(tmp).catch(() => {}) }
})
ipcMain.handle('file:openText', async (e, o: { filter: string; ext: string }) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openFile'], filters: [{ name: o.filter, extensions: [o.ext] }, { name: 'All files', extensions: ['*'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const stat = await fs.promises.stat(r.filePaths[0])
  if (stat.size > 50 * 1024 * 1024) throw new Error('The file is larger than 50 MB')
  return { path: r.filePaths[0], content: await fs.promises.readFile(r.filePaths[0], 'utf8') }
})

app.whenReady().then(() => {
  // No built-in menu: its hidden accelerators (Ctrl+R reload, Ctrl+W close window) clashed with the app's shortcuts
  Menu.setApplicationMenu(null)
  createWindow()
  startScheduler(() => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('schedules:changed') })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await Promise.allSettled([...clients.values()].map((c) => c.disconnect()))
  if (process.platform !== 'darwin') app.quit()
})
