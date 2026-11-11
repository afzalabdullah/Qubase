import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql, MSSQL, PostgreSQL, MySQL, SQLite, PLSQL, StandardSQL, SQLNamespace, SQLDialect } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'
import { keymap, EditorView, Decoration, DecorationSet } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { ExplainResult, QueryResult, TableInfo } from '../../shared/types'
import { ResultView } from './ResultView'
import { EditableResult } from './EditableResult'
import { addTile, PinContext } from '../dashboard'
import { toast } from 'sonner'
import { joinSource, valueSource } from '../smartComplete'
import type { ForeignKeyInfo } from '../../shared/types'
import { PlanView } from './PlanView'
import { AiPanel } from './AiPanel'
import { IconFormat, IconHistory, IconPlan, IconPlay, IconSpark, IconStar, IconStop, IconTrash } from './Icons'
import { errLine, errMsg } from '../util'
import { addHistory, readHistory, HistoryItem } from '../history'
import { allowRun, checkSql } from '../safety'
import { readSettings, shortcutFor, useConn, useSettings } from '../settings'
import { snippetSource } from '../snippets'
import { editorTheme } from '../editorThemes'
import { toCodeMirror } from '../shortcuts'
import { formatSqlText } from '../format'
import { findParams } from '../params'
import { ParamsDialog } from './ParamsDialog'
import { deleteSavedQuery, readSavedQueries, saveQuery, SavedQuery } from '../saved'

type Language = 'sql' | 'mongo' | 'redis'

const STARTER: Record<Language, string> = {
  sql: 'SELECT 1;',
  mongo: '// MongoDB shell syntax. Examples:\n// db.getCollectionNames()\n// db.users.find({ age: { $gt: 30 } }).sort({ name: 1 }).limit(50)\n// db.orders.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])\ndb.getCollectionNames()',
  redis: '# One Redis command per line; the last reply is shown.\n# SET greeting "hello world"\n# HGETALL user:1\nINFO server'
}

interface Props {
  /** The main connection; this tab opens its own connection from it */
  connId: string
  /** Changes when the sidebar switches database, so the tab knows to refresh labels */
  database?: string
  dialect: string
  dark: boolean
  language: Language
  title: string
  onStatus: (s: string) => void
  onRunningChange: (running: boolean) => void
  /** Starting text (e.g. a script opened from the sidebar) */
  initialText?: string
  /** Called after a CREATE / ALTER / DROP ran, so the sidebar reloads */
  onSchemaChanged?: () => void
  /** Reports the editor text (debounced) so tabs can be restored after a restart */
  onTextChange?: (text: string) => void
  /** File this tab is linked to, if any */
  filePath?: string
  /** Called after the tab is saved to or opened from a file */
  onFile?: (path: string) => void
  /** Reports whether the tab has changes that are not saved to a file */
  onDirty?: (dirty: boolean) => void
  /** Hands the app a function that saves this tab (asks for a file name if needed); resolves true when saved */
  registerSave?: (fn: () => Promise<boolean>) => void
}

interface Run {
  results: QueryResult[]
  /** The code that produced the results */
  sql?: string
  messages: { time: string; text: string; error?: boolean }[]
}

const clock = () => new Date().toLocaleTimeString()

const DIALECTS: Record<string, SQLDialect> = { mssql: MSSQL, postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, libsql: SQLite, oracle: PLSQL }
const DEFAULT_SCHEMA: Record<string, string> = { mssql: 'dbo', postgres: 'public' }
const NO_TX = new Set(['clickhouse', 'mongodb', 'redis', 'bigquery', 'cassandra', 'dynamodb', 'trino'])
const NO_PLAN = new Set(['mongodb', 'redis', 'cassandra', 'dynamodb'])

/** Row limit choices; 0 means load everything. */
const LIMITS = [1000, 10000, 50000, 100000, 0]
function readLimit() {
  try {
    const raw = localStorage.getItem('rowLimit')
    const v = Number(raw)
    if (raw !== null && LIMITS.includes(v)) return v
  } catch { /* ignore */ }
  return readSettings().rowLimit
}

// ---- Error line highlight ----
const setErrorLine = StateEffect.define<number | null>()
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none
      const line = tr.state.doc.line(e.value)
      return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)])
    }
    // Typing clears the marker
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** The statement around the cursor: split on ; (outside quotes and comments) and GO lines. */
function statementAt(doc: string, pos: number): string {
  const bounds: number[] = [0]
  let i = 0
  while (i < doc.length) {
    const c = doc[i]
    if (c === "'" || c === '"' || c === '`') { const end = doc.indexOf(c, i + 1); i = end < 0 ? doc.length : end + 1; continue }
    if (c === '-' && doc[i + 1] === '-') { const end = doc.indexOf('\n', i); i = end < 0 ? doc.length : end; continue }
    if (c === '/' && doc[i + 1] === '*') { const end = doc.indexOf('*/', i + 2); i = end < 0 ? doc.length : end + 2; continue }
    if (c === ';') bounds.push(i + 1)
    if (c === '\n' && /^\s*GO\s*$/i.test(doc.slice(i + 1, doc.indexOf('\n', i + 1) < 0 ? doc.length : doc.indexOf('\n', i + 1)))) bounds.push(i + 1)
    i++
  }
  bounds.push(doc.length)
  for (let k = 0; k < bounds.length - 1; k++) {
    const from = bounds[k], to = bounds[k + 1]
    // The cursor right after a ";" still belongs to that statement
    if (pos >= from && pos <= to && (doc.slice(from, to).trim() || k === bounds.length - 2)) {
      const s = doc.slice(from, to).trim()
      if (s && s !== ';') return s.replace(/^GO\s*$/im, '').trim()
      if (k > 0) return doc.slice(bounds[k - 1], from).trim()
    }
  }
  return doc
}

export function QueryTab({ connId, database, dialect, dark, language, title, onStatus, onRunningChange, initialText, onSchemaChanged, onTextChange, filePath, onFile, onDirty, registerSave }: Props) {
  const { conn } = useConn()
  const settings = useSettings()
  const [text, setText] = useState(initialText ?? STARTER[language])
  const [file, setFile] = useState(filePath)
  const [savedText, setSavedText] = useState(filePath ? (initialText ?? '') : null as string | null)
  const ext = language === 'sql' ? 'sql' : language === 'mongo' ? 'js' : 'txt'
  const fileFilter = language === 'sql' ? 'SQL script' : language === 'mongo' ? 'Mongo script' : 'Redis commands'
  const [baseline] = useState(() => initialText ?? STARTER[language])
  // Linked to a file: differs from the file. Not linked: has text beyond what the tab opened with.
  const dirty = file ? text !== savedText : text.trim() !== '' && text !== baseline && text !== STARTER[language]
  useEffect(() => { onDirty?.(dirty) }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveFile = async (as = false): Promise<boolean> => {
    try {
      const p = await window.db.saveTextFile(text, { name: (file?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '')) || title.replace(/[^\w -]/g, '') || 'query', filter: fileFilter, ext, path: as ? undefined : file })
      if (!p) return false
      setFile(p); setSavedText(text); onFile?.(p); onStatus(`Saved to ${p}`); return true
    } catch (e) { onStatus(`Could not save: ${errMsg(e)}`); return false }
  }
  useEffect(() => { registerSave?.(() => saveFile()) })
  const openFile = async () => {
    try {
      const f = await window.db.openTextFile({ filter: fileFilter, ext })
      if (!f) return
      setText(f.content); setFile(f.path); setSavedText(f.content); onFile?.(f.path); onStatus(`Opened ${f.path}`)
    } catch (e) { onStatus(`Could not open: ${errMsg(e)}`) }
  }
  const [run, setRun] = useState<Run | null>(null)
  // Pin a chart: only when the run was a single statement we can re-run
  const pinFn = run?.sql && run.results.length === 1 && language === 'sql'
    ? (chart: import('../dashboard').ChartCfg) => { addTile(conn.id, { title: title === 'Query' || /^Query \d+$/.test(title) ? chart.ys.join(', ') + ' by ' + chart.x : title, sql: run.sql!, chart }); onStatus('Pinned to the dashboard'); toast.success('Pinned to the dashboard', { description: 'Open it from the Dashboard icon on the left.' }) }
    : null
  const [plan, setPlan] = useState<ExplainResult | null>(null)
  const [activeResult, setActiveResult] = useState<number | 'messages' | 'plan'>(0)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [split, setSplit] = useState(42)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [menu, setMenu] = useState<'' | 'history' | 'saved'>('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [savedList, setSavedList] = useState<SavedQuery[]>([])
  const [saveName, setSaveName] = useState('')
  const [maxRows, setMaxRows] = useState(readLimit)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [columns, setColumns] = useState<Record<string, { name: string; dataType: string }[]>>({})
  const [inTx, setInTx] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [lastError, setLastError] = useState('')
  const [askParams, setAskParams] = useState<{ sql: string; names: string[] } | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isSql = language === 'sql'

  // Own connection per tab, so tabs run queries in parallel (like SSMS)
  useEffect(() => {
    let id: string | null = null
    let cancelled = false
    window.db.openSession(connId)
      .then((s) => { if (cancelled) window.db.closeSession(connId, s); else { id = s; setSessionId(s) } })
      .catch((e) => { setSessionError(errMsg(e)); setSessionId(connId) })
    return () => { cancelled = true; if (id) window.db.closeSession(connId, id) }
  }, [connId])

  useEffect(() => { try { localStorage.setItem('rowLimit', String(maxRows)) } catch { /* ignore */ } }, [maxRows])
  useEffect(() => {
    // Report every change at once (closing or reopening a tab needs the latest text); the app delays saving it
    onTextChange?.(text)
  }, [text, onTextChange])

  // Table names for autocomplete; reloaded when the sidebar switches database
  useEffect(() => {
    if (!isSql) return
    setColumns({})
    window.db.listTables(connId).then(setTables).catch(() => setTables([]))
  }, [connId, database, isSql])

  // Load columns for the tables mentioned in the editor, so "t." suggests its columns
  useEffect(() => {
    if (!isSql || !tables.length) return
    const timer = setTimeout(() => {
      const words = new Set(text.toLowerCase().match(/[\w$#@]+/g) ?? [])
      const missing = tables.filter((t) => words.has(t.name.toLowerCase()) && !columns[`${t.schema ?? ''}.${t.name}`]).slice(0, 10)
      for (const t of missing) {
        const key = `${t.schema ?? ''}.${t.name}`
        setColumns((c) => ({ ...c, [key]: [] }))
        window.db.listColumns(connId, t)
          .then((cols) => setColumns((c) => ({ ...c, [key]: cols.map((x) => ({ name: x.name, dataType: x.dataType })) })))
          .catch(() => {})
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [text, tables, columns, connId, isSql])

  // Column names (without "table.") from every table named in the query
  const columnsRef = useRef<{ tables: TableInfo[]; columns: typeof columns }>({ tables: [], columns: {} })
  columnsRef.current = { tables, columns }
  const columnSource = useCallback((ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w$#@]*/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    if (ctx.state.sliceDoc(word.from - 1, word.from) === '.') return null // "t." is handled by the SQL schema
    const { tables: ts, columns: cs } = columnsRef.current
    const words = new Set(ctx.state.doc.toString().toLowerCase().match(/[\w$#@]+/g) ?? [])
    const seen = new Map<string, { label: string; type: string; detail: string; boost: number }>()
    for (const t of ts) {
      if (!words.has(t.name.toLowerCase())) continue
      for (const c of cs[`${t.schema ?? ''}.${t.name}`] ?? []) {
        const prev = seen.get(c.name)
        if (prev) prev.detail = `${prev.detail.split(' · ')[0]} · several tables`
        else seen.set(c.name, { label: c.name, type: 'property', detail: `${c.dataType} · ${t.name}`, boost: 5 })
      }
    }
    if (!seen.size) return null
    return { from: word.from, options: [...seen.values()], validFor: /^[\w$#@]*$/ }
  }, [])

  // Foreign keys of every table, read once when JOIN suggestions are first needed
  const fkCache = useRef<{ for: TableInfo[]; p: Promise<Map<string, ForeignKeyInfo[]>> } | null>(null)
  const smart = useMemo(() => {
    const loadFks = () => {
      const ts = columnsRef.current.tables
      if (fkCache.current?.for === ts) return fkCache.current.p
      const p = (async () => {
        const m = new Map<string, ForeignKeyInfo[]>()
        const list = ts.filter((t) => t.type !== 'view').slice(0, 400)
        let i = 0
        await Promise.all(Array.from({ length: 6 }, async () => {
          while (i < list.length) {
            const t = list[i++]
            const st = await window.db.getStructure(connId, t).catch(() => null)
            if (st?.foreignKeys.length) m.set(`${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`, st.foreignKeys)
          }
        }))
        return m
      })()
      fkCache.current = { for: ts, p }
      return p
    }
    return {
      join: joinSource({ engine: dialect, tables: () => columnsRef.current.tables, foreignKeys: loadFks }),
      value: valueSource({
        engine: dialect,
        tables: () => columnsRef.current.tables,
        columnsOf: (t) => columnsRef.current.columns[`${t.schema ?? ''}.${t.name}`] ?? [],
        run: async (q) => (await window.db.query(connId, q)).rows.map((r) => Object.values(r)[0])
      })
    }
  }, [connId, dialect])

  /** Schema tree for the SQL autocomplete: schema → table → columns */
  const completionSchema = useMemo(() => {
    const ns: Record<string, Record<string, SQLNamespace>> = {}
    const top: Record<string, SQLNamespace> = {}
    for (const t of tables) {
      const cols = (columns[`${t.schema ?? ''}.${t.name}`] ?? []).map((c) => ({ label: c.name, type: 'property', detail: c.dataType }))
      const entry: SQLNamespace = { self: { label: t.name, type: t.type === 'view' ? 'interface' : 'class', detail: t.type === 'view' ? 'view' : 'table' }, children: cols }
      if (t.schema) (ns[t.schema] ??= {})[t.name] = entry
      else top[t.name] = entry
    }
    const schemas = Object.keys(ns)
    // Tables in the default schema (dbo, public, or the only one) complete without a prefix
    const defaultSchema = DEFAULT_SCHEMA[dialect] && ns[DEFAULT_SCHEMA[dialect]] ? DEFAULT_SCHEMA[dialect] : schemas.length === 1 ? schemas[0] : undefined
    return { schema: { ...ns, ...top } as SQLNamespace, defaultSchema }
  }, [tables, columns, dialect])

  // Live timer while a query runs
  useEffect(() => {
    if (!running) return
    const start = performance.now()
    const t = setInterval(() => setElapsed(performance.now() - start), 100)
    return () => clearInterval(t)
  }, [running])

  /** Line in the editor where the running code starts (for error lines in a selection) */
  const offsetLine = useRef(0)
  const markError = (line: number | undefined) => {
    const v = viewRef.current
    if (!v) return
    if (!line) { v.dispatch({ effects: setErrorLine.of(null) }); return }
    const abs = line + offsetLine.current
    if (abs < 1 || abs > v.state.doc.lines) return
    v.dispatch({ effects: setErrorLine.of(abs), selection: { anchor: v.state.doc.line(abs).from }, scrollIntoView: true })
  }

  const execute = useCallback(async (code: string, filled = false) => {
    if (!code.trim() || !sessionId || running) return
    // :name parameters: ask for the values first
    if (isSql && !filled && readSettings().queryParams) {
      const names = findParams(code)
      if (names.length) { setAskParams({ sql: code, names }); return }
    }
    if (!allowRun(conn, checkSql(code, language))) return
    setRunning(true); onRunningChange(true); setElapsed(0)
    markError(undefined)
    const started = performance.now()
    try {
      const results = await window.db.queryMulti(sessionId, code, maxRows)
      const ms = Math.round(performance.now() - started)
      const messages = results.map((r, i) => ({
        time: clock(),
        text: r.columns.length
          ? `Result ${i + 1}: ${r.rowCount.toLocaleString()} row${r.rowCount === 1 ? '' : 's'} returned${r.truncated ? ` (stopped at the row limit; more rows exist)` : ''}`
          : `Statement ${i + 1}: ${r.rowCount} row${r.rowCount === 1 ? '' : 's'} affected`
      }))
      messages.push({ time: clock(), text: `Completed in ${ms} ms` })
      setRun({ results, messages, sql: code })
      setLastError('')
      const firstGrid = results.findIndex((r) => r.columns.length)
      setActiveResult(firstGrid >= 0 ? firstGrid : 'messages')
      const total = results.reduce((n, r) => n + (r.columns.length ? r.rowCount : 0), 0)
      onStatus(`${results.length > 1 ? results.length + ' results · ' : ''}${total} rows · ${ms} ms`)
      addHistory({ text: code, at: Date.now(), ok: true, ms })
      if (/\b(create|alter|drop|rename)\b|sp_rename/i.test(code)) onSchemaChanged?.()
      // Follow transactions typed by hand, so the Commit / Rollback buttons show
      const bare = code.replace(/--[^\n]*/g, '')
      if (/\b(begin\s+tran(saction)?|start\s+transaction)\b|^\s*begin\s*;/im.test(bare)) setInTx(true)
      if (/^\s*(commit|rollback)\b/im.test(bare)) setInTx(false)
    } catch (e) {
      const msg = errMsg(e)
      const line = errLine(e)
      setRun({ results: [], messages: [{ time: clock(), text: line ? `${msg} (line ${line + offsetLine.current})` : msg, error: true }] })
      setActiveResult('messages')
      setLastError(msg)
      markError(line)
      onStatus('Query failed')
      addHistory({ text: code, at: Date.now(), ok: false, ms: Math.round(performance.now() - started) })
    } finally {
      setRunning(false); onRunningChange(false)
    }
  }, [sessionId, running, onStatus, onRunningChange, maxRows, onSchemaChanged, conn, language, isSql])

  const stop = () => { if (sessionId) window.db.cancel(sessionId).catch((e) => onStatus(`Stop failed: ${errMsg(e)}`)) }

  /** The code F5 runs: the selection, else the statement under the cursor (setting) or everything. */
  const codeToRun = useCallback(() => {
    const v = viewRef.current
    if (!v) { offsetLine.current = 0; return text }
    const sel = v.state.selection.main
    if (!sel.empty) {
      offsetLine.current = v.state.doc.lineAt(sel.from).number - 1
      return v.state.sliceDoc(sel.from, sel.to)
    }
    const doc = v.state.doc.toString()
    if (isSql && readSettings().runCurrentStatement) {
      const stmt = statementAt(doc, sel.head)
      const at = doc.indexOf(stmt)
      offsetLine.current = at > 0 ? v.state.doc.lineAt(at).number - 1 : 0
      return stmt
    }
    offsetLine.current = 0
    return doc
  }, [text, isSql])

  const runCurrent = useCallback(() => execute(codeToRun()), [execute, codeToRun])

  const explain = async () => {
    const code = codeToRun()
    if (!code.trim() || !sessionId || running) return
    setRunning(true); onRunningChange(true)
    try {
      const p = await window.db.explain(sessionId, code)
      setPlan(p); setActiveResult('plan')
      setRun((r) => r ?? { results: [], messages: [] })
      onStatus('Estimated plan (the query was not run)')
    } catch (e) {
      setRun({ results: [], messages: [{ time: clock(), text: `Plan failed: ${errMsg(e)}`, error: true }] })
      setActiveResult('messages')
    } finally { setRunning(false); onRunningChange(false) }
  }

  const tx = async (action: 'begin' | 'commit' | 'rollback') => {
    if (!sessionId) return
    if (action === 'commit' && !allowRun(conn, { what: 'COMMIT the open transaction' })) return
    try {
      await window.db.transaction(sessionId, action)
      setInTx(action === 'begin')
      onStatus(action === 'begin' ? 'Transaction started: changes stay hidden from others until Commit' : action === 'commit' ? 'Committed' : 'Rolled back')
    } catch (e) { onStatus(`${action} failed: ${errMsg(e)}`) }
  }

  const doFormat = () => {
    if (!isSql) return
    try {
      // Format only the selection when there is one
      const v = viewRef.current
      const sel = v?.state.selection.main
      // Change the editor directly so it updates at once and Ctrl+Z undoes it
      if (v && sel && !sel.empty) {
        v.dispatch({ changes: { from: sel.from, to: sel.to, insert: formatSqlText(v.state.sliceDoc(sel.from, sel.to), dialect) } })
      } else if (v) {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: formatSqlText(v.state.doc.toString(), dialect) } })
      } else setText(formatSqlText(text, dialect))
    } catch (e) {
      onStatus(`Format failed: ${errMsg(e)}`)
    }
  }

  /** Tables and columns as text for the AI assistant (all columns for small databases, else the tables mentioned) */
  const schemaText = async () => {
    const mentioned = new Set(`${text}`.toLowerCase().match(/[\w$#@]+/g) ?? [])
    const want = tables.length <= 60 ? tables : tables.filter((t) => mentioned.has(t.name.toLowerCase())).slice(0, 40)
    const cols = await Promise.all(want.map((t) => columns[`${t.schema ?? ''}.${t.name}`]?.length
      ? Promise.resolve(columns[`${t.schema ?? ''}.${t.name}`])
      : window.db.listColumns(connId, t).catch(() => [])))
    const detailed = new Set(want.map((t) => `${t.schema ?? ''}.${t.name}`))
    const lines = want.map((t, i) => `${t.schema ? t.schema + '.' : ''}${t.name}${t.type === 'view' ? ' (view)' : ''}: ${cols[i].map((c) => `${c.name} ${c.dataType}`).join(', ')}`)
    const others = tables.filter((t) => !detailed.has(`${t.schema ?? ''}.${t.name}`)).slice(0, 500).map((t) => (t.schema ? `${t.schema}.${t.name}` : t.name))
    if (others.length) lines.push(`Other tables (columns not listed): ${others.join(', ')}`)
    return lines.join('\n')
  }

  const extensions = useMemo(() => [
    ...(isSql ? (() => {
      const lang = sql({ dialect: DIALECTS[dialect] ?? StandardSQL, upperCaseKeywords: true, schema: completionSchema.schema, defaultSchema: completionSchema.defaultSchema })
      return [lang, lang.language.data.of({ autocomplete: columnSource }), lang.language.data.of({ autocomplete: smart.join }), lang.language.data.of({ autocomplete: smart.value }), ...(settings.snippets ? [lang.language.data.of({ autocomplete: snippetSource })] : [])]
    })() : language === 'mongo' ? [javascript()] : []),
    errorLineField,
    keymap.of([
      { key: toCodeMirror(shortcutFor(settings, 'run')), run: () => { runCurrent(); return true } },
      { key: 'F5', run: () => { runCurrent(); return true } },
      { key: toCodeMirror(shortcutFor(settings, 'plan')), run: () => { if (isSql && !NO_PLAN.has(dialect)) explain(); return true } },
      { key: toCodeMirror(shortcutFor(settings, 'format')), run: () => { doFormat(); return true } },
      // Save to the library: open the Saved menu with the name box ready
      { key: toCodeMirror(shortcutFor(settings, 'saveQuery')), run: () => { setSavedList(readSavedQueries()); setSaveName(''); setMenu('saved'); return true } },
      { key: toCodeMirror(shortcutFor(settings, 'saveFile')), run: () => { saveFile(); return true } },
      { key: toCodeMirror(shortcutFor(settings, 'saveFileAs')), run: () => { saveFile(true); return true } }
    ].filter((k) => k.key)),
    EditorView.theme({ '&': { fontSize: 'var(--editor-font, 13px)' } })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [runCurrent, language, text, completionSchema, dialect, columnSource, settings, file, smart])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const box = wrapRef.current!.getBoundingClientRect()
    const move = (ev: MouseEvent) => setSplit(Math.min(85, Math.max(12, ((ev.clientY - box.top) / box.height) * 100)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const current = run && typeof activeResult === 'number' ? run.results[activeResult] : null
  const ownSession = !!sessionId && sessionId !== connId

  return (
    <div className="query-tab-wrap">
      <div className="query-tab" ref={wrapRef}>
        <div className="editor-toolbar">
          <button className="btn btn-primary btn-sm" onClick={runCurrent} disabled={running || !sessionId} title={`Run (F5 or ${shortcutFor(settings, 'run')}). Runs the selection if any.`}>
            <IconPlay width={12} height={12} /> {running ? 'Running…' : 'Run'}
          </button>
          {running && <button className="btn btn-sm" onClick={stop} title="Stop the running query"><IconStop width={12} height={12} /> Stop</button>}
          {running && <span className="timer">{(elapsed / 1000).toFixed(1)}s</span>}
          {isSql && !NO_PLAN.has(dialect) && (
            <button className="btn btn-sm" onClick={explain} disabled={running || !sessionId} title={`Show the estimated plan without running the query (${shortcutFor(settings, 'plan')})`}><IconPlan width={14} height={14} /> Plan</button>
          )}
          <select className="row-limit" value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))} title="Maximum rows to load per result">
            {LIMITS.map((n) => <option key={n} value={n}>{n ? `${n.toLocaleString()} rows` : 'All rows'}</option>)}
          </select>
          {isSql && !NO_TX.has(dialect) && (
            inTx ? (
              <span className="tx-group">
                <span className="pill warn" title="Changes in this tab are not visible to others until you commit">Transaction open</span>
                <button className="btn btn-sm" onClick={() => tx('commit')}>Commit</button>
                <button className="btn btn-sm" onClick={() => tx('rollback')}>Rollback</button>
              </span>
            ) : (
              <button className="btn btn-sm" onClick={() => tx('begin')} disabled={!sessionId || running} title="Start a transaction in this tab; then Commit or Rollback">Begin</button>
            )
          )}
          {isSql && <button className="btn btn-sm" onClick={doFormat} title={`Format SQL, or only the selection (${shortcutFor(settings, 'format')})`}><IconFormat width={14} height={14} /> Format</button>}
          <div className="menu-wrap">
            <button className="btn btn-sm" onClick={() => { setHistory(readHistory()); setMenu((m) => (m === 'history' ? '' : 'history')) }}><IconHistory width={14} height={14} /> History</button>
            {menu === 'history' && (
              <>
                <div className="menu-backdrop" onClick={() => setMenu('')} />
                <div className="menu history-menu">
                  {history.length === 0 && <div className="empty pad">No queries yet</div>}
                  {history.map((h) => (
                    <button key={h.at} onClick={() => { setText(h.text); setMenu('') }} title={h.text}>
                      <span className={`hist-dot ${h.ok ? 'ok' : 'bad'}`} />
                      <span className="hist-text">{h.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
                      <span className="hist-time">{new Date(h.at).toLocaleTimeString()}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="file-btns">
            <button className="btn btn-sm" onClick={openFile} title={`Open a ${ext} file into this tab (${shortcutFor(settings, 'openFile')} opens one in a new tab)`}>Open</button>
            <button className="btn btn-sm" onClick={() => saveFile()} title={`${file ? 'Save to ' + file : 'Save to a file'} (${shortcutFor(settings, 'saveFile')})`}>Save{dirty ? ' •' : ''}</button>
            <button className="btn btn-sm" onClick={() => saveFile(true)} title={`Save to a new file (${shortcutFor(settings, 'saveFileAs')})`}>Save as</button>
          </div>
          <div className="menu-wrap">
            <button className="btn btn-sm" onClick={() => { setSavedList(readSavedQueries()); setSaveName(''); setMenu((m) => (m === 'saved' ? '' : 'saved')) }}><IconStar width={14} height={14} /> Saved</button>
            {menu === 'saved' && (
              <>
                <div className="menu-backdrop" onClick={() => setMenu('')} />
                <div className="menu history-menu saved-menu">
                  <form className="save-row" onSubmit={(e) => { e.preventDefault(); if (saveName.trim()) { setSavedList(saveQuery(saveName.trim(), text, dialect)); onStatus(`Saved “${saveName.trim()}”`); setSaveName('') } }}>
                    <input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name to save this query as" />
                    <button className="btn btn-sm btn-primary" disabled={!saveName.trim()}>Save</button>
                  </form>
                  {savedList.length === 0 && <div className="empty pad">No saved queries yet</div>}
                  {savedList.map((q) => (
                    <div key={q.id} className="saved-item">
                      <button onClick={() => { setText(q.text); setMenu('') }} title={q.text}>
                        <span className="hist-text"><strong>{q.name}</strong> <span className="muted">{q.text.replace(/\s+/g, ' ').slice(0, 60)}</span></span>
                      </button>
                      <button className="icon-btn" title="Delete" onClick={() => setSavedList(deleteSavedQuery(q.id))}><IconTrash width={13} height={13} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className={`btn btn-sm ${aiOpen ? 'btn-on' : ''}`} onClick={() => setAiOpen((o) => !o)} title="AI assistant: write, explain or fix SQL"><IconSpark width={14} height={14} /> AI</button>
          <div className="spacer" />
          <span className="hint" title="This tab has its own connection, so it can run at the same time as other tabs">
            {ownSession ? '● Own connection' : sessionError ? 'Shared connection' : '● Connected'}
          </span>
        </div>
        <div className="editor-pane" style={{ height: `${split}%` }}>
          <CodeMirror
            value={text}
            height="100%"
            theme={editorTheme(settings.editorTheme, dark)}
            extensions={extensions}
            onChange={setText}
            onCreateEditor={(v) => { viewRef.current = v }}
            basicSetup={{ highlightActiveLine: true, foldGutter: false }}
          />
        </div>
        <div className="splitter" onMouseDown={startDrag} />
        <div className="results-pane">
          {run && (run.results.length > 1 || run.messages.some((m) => m.error) || !run.results.some((r) => r.columns.length) || plan) && (
            <div className="result-tabs">
              {run.results.map((r, i) => r.columns.length > 0 && (
                <button key={i} className={activeResult === i ? 'on' : ''} onClick={() => setActiveResult(i)}>
                  Result {i + 1} <span className="badge">{r.rowCount}</span>
                </button>
              ))}
              {plan && <button className={activeResult === 'plan' ? 'on' : ''} onClick={() => setActiveResult('plan')}>Plan</button>}
              <button className={activeResult === 'messages' ? 'on' : ''} onClick={() => setActiveResult('messages')}>
                Messages {run.messages.some((m) => m.error) && <span className="badge err">!</span>}
              </button>
            </div>
          )}
          {!run && <div className="placeholder">{running ? 'Running…' : 'Run a query to see results here'}</div>}
          {run && activeResult === 'messages' && (
            <div className="messages">
              {run.messages.length === 0 && <div className="msg muted">No messages</div>}
              {run.messages.map((m, i) => (
                <div key={i} className={`msg ${m.error ? 'error' : ''}`}><span className="msg-time">{m.time}</span>{m.text}</div>
              ))}
            </div>
          )}
          {activeResult === 'plan' && plan && <PlanView result={plan} />}
          {current && (isSql && run?.sql && run.results.length === 1
            ? <PinContext.Provider value={pinFn}><EditableResult result={current} sql={run.sql} tables={tables} name={`${title} result 1`} onStatus={onStatus} /></PinContext.Provider>
            : <PinContext.Provider value={pinFn}><ResultView result={current} name={`${title} result ${(activeResult as number) + 1}`} onStatus={onStatus} /></PinContext.Provider>)}
        </div>
      </div>
      {askParams && (
        <ParamsDialog sql={askParams.sql} names={askParams.names} onClose={() => setAskParams(null)}
          onRun={(sql) => { setAskParams(null); execute(sql, true) }} />
      )}
      {aiOpen && (
        <AiPanel
          engine={dialect}
          getSchema={schemaText}
          getSql={() => codeToRun()}
          lastError={lastError}
          onInsert={(code) => {
            const v = viewRef.current
            if (!v) { setText(code); return }
            const sel = v.state.selection.main
            // Replace the selection, or add the SQL on new lines at the end
            if (!sel.empty) v.dispatch({ changes: { from: sel.from, to: sel.to, insert: code } })
            else v.dispatch({ changes: { from: v.state.doc.length, insert: `${v.state.doc.length ? '\n\n' : ''}${code}` } })
            v.focus()
          }}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  )
}
