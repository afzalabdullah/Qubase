// Auto-update with electron-updater. By default it reads the GitHub releases set in package.json "build.publish";
// a custom update address (Settings → updateUrl) switches it to a plain web folder holding latest.yml.
// Updates are never installed silently: the user is asked to download, then to restart.
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'
import { writeLog } from './log'

let last: UpdateStatus = { state: 'idle', current: app.getVersion() }

function send(s: Partial<UpdateStatus>) {
  last = { ...last, ...s, current: app.getVersion() }
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('update:status', last)
}

function useFeed(url?: string) {
  if (url && /^https:\/\//i.test(url)) autoUpdater.setFeedURL({ provider: 'generic', url: url.replace(/\/+$/, '') })
}

export function installUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => send({ state: 'checking', error: undefined }))
  autoUpdater.on('update-available', (i) => send({ state: 'available', latest: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : undefined }))
  autoUpdater.on('update-not-available', (i) => send({ state: 'none', latest: i.version }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', latest: i.version, percent: 100 }))
  autoUpdater.on('error', (e) => { writeLog('update', e?.message ?? String(e)); send({ state: 'error', error: e?.message ?? String(e) }) })

  ipcMain.handle('update:check', async (_e, url?: string) => {
    if (!app.isPackaged) { send({ state: 'error', error: 'Updates only work in the installed app' }); return last }
    useFeed(url)
    await autoUpdater.checkForUpdates().catch(() => {})
    return last
  })
  ipcMain.handle('update:download', async () => { await autoUpdater.downloadUpdate().catch(() => {}); return last })
  ipcMain.handle('update:install', () => { setImmediate(() => autoUpdater.quitAndInstall(false, true)) })
  ipcMain.handle('update:status', () => last)
}
