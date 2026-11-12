// Scheduled queries: run a saved query on a timer while the app is open and
// write the result to a file (CSV, Excel, JSON…). Jobs live in schedules.json.
import { app, Notification } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from './db'
import { listSaved } from './store'
import { exportRows } from './export'
import { openTunnel } from './tunnel'
import { writeLog } from './log'
import type { ConnectionConfig, Schedule, ScheduleRun } from '../shared/types'

const file = () => path.join(app.getPath('userData'), 'schedules.json')
const EXT: Record<string, string> = { csv: 'csv', excel: 'xlsx', json: 'json', sql: 'sql', markdown: 'md', html: 'html' }
const running = new Set<string>()
let timer: NodeJS.Timeout | null = null
let onChange: (() => void) | null = null

export function listSchedules(): Schedule[] {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { return [] }
}
function write(list: Schedule[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(list, null, 2))
  onChange?.()
}
export function saveSchedule(s: Schedule): Schedule[] {
  const list = listSchedules()
  const i = list.findIndex((x) => x.id === s.id)
  // A changed timing starts counting again from now
  const next = { ...s, nextRun: nextRunAfter(s, Date.now()) }
  if (i >= 0) list[i] = { ...list[i], ...next } ; else list.push(next)
  write(list)
  return list
}
export function deleteSchedule(id: string): Schedule[] {
  const list = listSchedules().filter((x) => x.id !== id)
  write(list)
  return list
}

/** When the job should run next, after `from` */
export function nextRunAfter(s: Schedule, from: number): number {
  if (s.every === 'daily' || s.every === 'weekdays') {
    const [h, m] = (s.at || '08:00').split(':').map(Number)
    const d = new Date(from)
    d.setSeconds(0, 0); d.setHours(h || 0, m || 0)
    if (d.getTime() <= from) d.setDate(d.getDate() + 1)
    while (s.every === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  return from + Math.max(1, s.minutes || 60) * 60_000
}

/** File name with the date and time, so runs don't overwrite each other (unless asked) */
function outFile(s: Schedule) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  const base = (s.fileName || s.name).replace(/[\\/:*?"<>|]+/g, '_')
  return path.join(s.folder, `${base}${s.overwrite ? '' : '-' + stamp}.${EXT[s.format] ?? 'csv'}`)
}

export async function runSchedule(id: string): Promise<ScheduleRun> {
  const s = listSchedules().find((x) => x.id === id)
  if (!s) throw new Error('Schedule not found')
  if (running.has(id)) throw new Error('This schedule is already running')
  running.add(id)
  const started = Date.now()
  let run: ScheduleRun
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined
  try {
    const conn = listSaved().find((c) => c.id === s.connectionId)
    if (!conn) throw new Error('The saved connection was deleted')
    let config: ConnectionConfig = { ...conn.config, database: s.database || conn.config.database }
    if (config.ssh?.enabled) { tunnel = await openTunnel(config); config = tunnel.config }
    const client = createClient(config)
    await client.connect()
    try {
      const results = client.queryMulti ? await client.queryMulti(s.sql, s.maxRows || 0) : [await client.query(s.sql)]
      const r = [...results].reverse().find((x) => x.columns.length) ?? results[results.length - 1]
      if (!s.folder) throw new Error('Choose a folder for the files')
      fs.mkdirSync(s.folder, { recursive: true })
      const out = outFile(s)
      if (r?.columns.length) await exportRows({ columns: r.columns, rows: r.rows }, s.format, out, s.name.replace(/\W+/g, '_'), undefined)
      run = { at: started, ok: true, ms: Date.now() - started, rows: r?.rows.length ?? 0, file: r?.columns.length ? out : undefined }
    } finally { await client.disconnect().catch(() => {}) }
  } catch (e) {
    run = { at: started, ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) }
    writeLog('schedule', `${s.name}: ${run.error}`)
  } finally {
    tunnel?.close()
    running.delete(id)
  }
  // Keep the last 20 runs
  const list = listSchedules()
  const cur = list.find((x) => x.id === id)
  if (cur) {
    cur.history = [run, ...(cur.history ?? [])].slice(0, 20)
    cur.nextRun = nextRunAfter(cur, Date.now())
    write(list)
  }
  if (s.notify && Notification.isSupported()) {
    new Notification({ title: run.ok ? `${s.name} finished` : `${s.name} failed`, body: run.ok ? `${run.rows} rows${run.file ? ` → ${path.basename(run.file)}` : ''}` : run.error }).show()
  }
  return run
}

/** Check every 30 seconds for jobs that are due */
export function startScheduler(changed: () => void) {
  onChange = changed
  if (timer) return
  const tick = () => {
    const now = Date.now()
    for (const s of listSchedules()) {
      if (!s.enabled || running.has(s.id)) continue
      // A job missed while the app was closed runs once, then follows its timing again
      if (!s.nextRun) { saveSchedule(s); continue }
      if (s.nextRun <= now) runSchedule(s.id).catch(() => {})
    }
  }
  timer = setInterval(tick, 30_000)
  setTimeout(tick, 5_000)
}
