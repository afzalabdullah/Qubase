import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Local crash and error log (nothing is sent anywhere). Kept under 2 MB.
export const logFolder = () => path.join(app.getPath('userData'), 'logs')
const logFile = () => path.join(logFolder(), 'dbstudio.log')

export function writeLog(source: string, text: string) {
  try {
    fs.mkdirSync(logFolder(), { recursive: true })
    const f = logFile()
    if (fs.existsSync(f) && fs.statSync(f).size > 2 * 1024 * 1024) fs.renameSync(f, f + '.old')
    fs.appendFileSync(f, `[${new Date().toISOString()}] [${source}] ${text}\n`)
  } catch { /* logging must never crash the app */ }
}

export function installCrashLog() {
  process.on('uncaughtException', (e) => writeLog('main', e.stack ?? String(e)))
  process.on('unhandledRejection', (e) => writeLog('main', e instanceof Error ? e.stack ?? e.message : String(e)))
  app.on('render-process-gone', (_e, _wc, d) => writeLog('renderer', `gone: ${d.reason} (exit ${d.exitCode})`))
  app.on('child-process-gone', (_e, d) => writeLog('child', `${d.type} gone: ${d.reason}`))
}

export const openLogFolder = async () => {
  fs.mkdirSync(logFolder(), { recursive: true })
  await shell.openPath(logFolder())
}
