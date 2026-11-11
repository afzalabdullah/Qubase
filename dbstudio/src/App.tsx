import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SavedConnection, TableInfo, TeamQuery } from '../shared/types'
import { ConnectionScreen } from './components/ConnectionScreen'
import { Sidebar, TableView } from './components/Sidebar'
import { TableDesigner } from './components/TableDesigner'
import { QueryTab } from './components/QueryTab'
import { startTour, tourSeen } from './tour'
import { Dashboard } from './components/Dashboard'
import { Workspace, WorkspacesModal, WsTab } from './components/Workspaces'
import { TableTab } from './components/TableTab'
import { SettingsModal, SettingsSection, ShortcutsHelp } from './components/SettingsModal'
import { CommandPalette, Command } from './components/CommandPalette'
import { ServerTools } from './components/ServerTools'
import { ImportDialog } from './components/ImportDialog'
import { ErDiagram } from './components/ErDiagram'
import { SchemaCompare } from './components/SchemaCompare'
import { DataCompare } from './components/DataCompare'
import { Notebook } from './components/Notebook'
import { QueryBuilder } from './components/QueryBuilder'
import { FindInDb } from './components/FindInDb'
import { Schedules } from './components/Schedules'
import { IconBook, IconBuilder, IconCode, IconCompare, IconDiagram, IconGear, IconMoon, IconPlus, IconSearch, IconServer, IconSidebar, IconKeyboard, IconClock, IconDatabase, IconSun, IconTable, IconX, IconUsers, IconJobs, IconBackup, IconActivity, IconRows, IconUpload, IconChart, IconLayers, IconLayoutDashboard, IconCompass } from './components/Icons'
import { Toaster, toast } from 'sonner'
import { driverFor, queryLanguage } from '../shared/drivers'
import { applySettings, ConnContext, readSettings, resolvedTheme, shortcutFor, useSettings, writeSettings } from './settings'
import { ACTIONS, EDITOR_ACTIONS, matches, ShortcutAction } from './shortcuts'
import { readSavedQueries } from './saved'

type ToolSection = 'activity' | 'users' | 'jobs' | 'backup'

type Tab =
  | { key: string; kind: 'query'; title: string; text?: string; file?: string }
  | { key: string; kind: 'table'; title: string; table: TableInfo; view?: TableView; nonce?: number; where?: string }
  | { key: string; kind: 'newtable'; title: string }
  | { key: string; kind: 'tools'; title: string; section: ToolSection; nonce?: number }
  | { key: string; kind: 'er'; title: string }
  | { key: string; kind: 'compare'; title: string }
  | { key: string; kind: 'datacompare'; title: string }
  | { key: string; kind: 'notebook'; title: string }
  | { key: string; kind: 'builder'; title: string }
  | { key: string; kind: 'search'; title: string }
  | { key: string; kind: 'schedules'; title: string }
  | { key: string; kind: 'dashboard'; title: string }

// Send uncaught UI errors to the local log file
window.addEventListener('error', (e) => { window.db?.logError(`${e.message}\n${e.error?.stack ?? ''}`).catch(() => {}) })
window.addEventListener('unhandledrejection', (e) => { window.db?.logError(`Unhandled: ${e.reason?.stack ?? e.reason}`).catch(() => {}) })
applySettings(readSettings()) // font size, theme and accent

let tabCounter = 1

/** Saved query tabs of a connection (title + text), restored after a restart */
const tabsKey = (connId: string) => `tabs:${connId}`
function readSavedTabs(connId: string): { title: string; text: string; pinned?: boolean; file?: string }[] {
  try { return JSON.parse(localStorage.getItem(tabsKey(connId)) ?? '[]') } catch { return [] }
}

export function App() {
  const settings = useSettings()
  const theme = resolvedTheme(settings)
  const [session, setSession] = useState<{ id: string; canEdit: boolean; conn: SavedConnection } | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([{ key: 'q1', kind: 'query', title: 'Query 1' }])
  const [active, setActive] = useState('q1')
  const [status, setStatus] = useState<Record<string, string>>({})
  // Bumped after DDL so the sidebar reloads its tree
  const [schemaVersion, setSchemaVersion] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAt, setSettingsAt] = useState<SettingsSection | undefined>()
  const [helpOpen, setHelpOpen] = useState(false)
  const openSettings = (at?: SettingsSection) => { setSettingsAt(at); setSettingsOpen(true) }
  // Query tabs closed this session, newest last (Reopen closed tab)
  const closedTabs = useRef<{ title: string; text: string }[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteTables, setPaletteTables] = useState<TableInfo[]>([])
  const [toolsOpen, setToolsOpen] = useState(false)
  // Queries shared in the team folder (Settings), refreshed when the palette opens
  const [teamQueries, setTeamQueries] = useState<TeamQuery[]>([])
  useEffect(() => {
    if (!paletteOpen || !settings.teamFolder) { if (!settings.teamFolder) setTeamQueries([]); return }
    window.db.readTeam(settings.teamFolder).then((t) => setTeamQueries(t.queries)).catch(() => setTeamQueries([]))
  }, [paletteOpen, settings.teamFolder])
  // Pinned tabs sit first and can't be closed by accident
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  // Tab shown on the right of the active one (split view)
  const [side, setSide] = useState('')
  const [, setDirtyTick] = useState(0)
  const [importNew, setImportNew] = useState(false)
  const [wsOpen, setWsOpen] = useState(false)
  const dirtyRef = useRef<Record<string, boolean>>({})
  const savers = useRef<Record<string, () => Promise<boolean>>>({})
  const [confirmClose, setConfirmClose] = useState<{ keys: string[]; unsaved: string[]; includePinned: boolean; quit?: boolean } | null>(null)
  // Closing the window: ask about unsaved query tabs first
  useEffect(() => window.db.onCloseRequest?.(() => {
    const unsaved = Object.keys(dirtyRef.current).filter((k) => dirtyRef.current[k])
    if (!unsaved.length) window.db.confirmClose()
    else setConfirmClose({ keys: unsaved, unsaved, includePinned: true, quit: true })
  }), [])
  const [tabMenu, setTabMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  // Current text of each query tab, saved so tabs come back after a restart
  const texts = useRef<Record<string, string>>({})

  const toggleTheme = () => { const s = readSettings(); writeSettings({ ...s, theme: resolvedTheme(s) === 'dark' ? 'light' : 'dark' }) }
  const statusFor = useCallback((key: string) => (s: string) => setStatus((m) => ({ ...m, [key]: s })), [])
  // Tabs with a query in progress (several can run at once)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const runningFor = useCallback((key: string) => (on: boolean) =>
    setRunning((r) => { const n = new Set(r); on ? n.add(key) : n.delete(key); return n }), [])

  /** Write the query tabs (in order) for this connection */
  const persistTabs = useCallback((list: Tab[]) => {
    if (!session || !readSettings().restoreTabs) return
    const q = list.filter((t) => t.kind === 'query').map((t) => ({ title: t.title, text: texts.current[t.key] ?? (t as { text?: string }).text ?? '', file: (t as { file?: string }).file, pinned: pinnedRef.current.has(t.key) || undefined }))
    try { localStorage.setItem(tabsKey(session.conn.id), JSON.stringify(q.slice(0, 30))) } catch { /* storage full */ }
  }, [session])
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  useEffect(() => { persistTabs(tabs) }, [tabs, pinned, persistTabs])
  const persistTimer = useRef<ReturnType<typeof setTimeout>>()
  const textFor = useCallback((key: string) => (text: string) => {
    texts.current[key] = text
    clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => persistTabs(tabsRef.current), 600)
  }, [persistTabs])

  // App-wide keyboard shortcuts (changeable in Settings). Ctrl+Shift+P always opens the palette too.
  const keyActions = useRef<Record<string, () => void>>({})
  // Sidebar: drag its edge to resize, Ctrl+B or the toolbar button to hide it
  const [sideW, setSideW] = useState(() => { try { return Math.min(480, Math.max(200, Number(localStorage.getItem('sidebarW')) || 280)) } catch { return 280 } })
  const [sideHidden, setSideHidden] = useState(() => { try { const v = localStorage.getItem('sidebarHidden'); return v === null ? window.innerWidth < 1000 : v === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('sidebarW', String(sideW)); localStorage.setItem('sidebarHidden', sideHidden ? '1' : '0') } catch { /* ignore */ } }, [sideW, sideHidden])
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = sideW
    const move = (m: MouseEvent) => setSideW(Math.min(480, Math.max(200, w0 + m.clientX - x0)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing') }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  // Keep the active tab in view when there are many
  useEffect(() => { document.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [active])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!session || document.querySelector('.settings-modal')) return
      const a = keyActions.current
      const hit = ACTIONS.filter((k) => !EDITOR_ACTIONS.includes(k)).find((k) => matches(e, shortcutFor(settings, k)))
      const run = hit ? a[hit] : (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') ? a.palette : undefined
      if (run) { e.preventDefault(); e.stopPropagation(); run() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, settings])

  useEffect(() => {
    if (paletteOpen && session) window.db.listTables(session.id).then(setPaletteTables).catch(() => setPaletteTables([]))
  }, [paletteOpen, session])

  const themeBtn = (
    <button className="icon-btn theme-toggle" onClick={toggleTheme} title="Toggle theme">
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  )

  const cfg = session?.conn.config
  const engine = cfg ? driverFor(cfg.kind).engine : ''
  const connValue = useMemo(() => session && { conn: session.conn, engine, connId: session.id }, [session, engine])

  // First time on the main screen: show the guided tour once
  const sessionId = session?.id
  useEffect(() => {
    if (!sessionId || tourSeen()) return
    const h = setTimeout(() => startTour({ sqlLike: !!cfg && queryLanguage(cfg.kind) === 'sql', paletteKey: shortcutFor(settings, 'palette') }), 900)
    return () => clearTimeout(h)
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!session || !cfg || !connValue) {
    return (
      <>
        <ConnectionScreen onConnected={(id, canEdit, conn) => {
          setSession({ id, canEdit: canEdit && !conn.readOnly, conn })
          const restored = readSettings().restoreTabs ? readSavedTabs(conn.id) : []
          texts.current = {}
          if (restored.length) {
            const list: Tab[] = restored.map((t, i) => ({ key: `q${i + 1}`, kind: 'query', title: t.title, text: t.text, file: t.file }))
            restored.forEach((t, i) => { texts.current[`q${i + 1}`] = t.text })
            setPinned(new Set(restored.flatMap((t, i) => (t.pinned ? [`q${i + 1}`] : []))))
            tabCounter = restored.length
            setTabs(list)
            setActive(list[0].key)
          } else {
            tabCounter = 1
            setTabs([{ key: 'q1', kind: 'query', title: 'Query 1' }])
            setActive('q1')
          }
          setStatus({})
        }} />
        <div className="floating-theme">
          <button className="icon-btn" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts"><IconKeyboard /></button>
          <button className="icon-btn" onClick={() => openSettings()} title="Settings"><IconGear /></button>
          {themeBtn}
        </div>
        {settingsOpen && <SettingsModal section={settingsAt} onClose={() => setSettingsOpen(false)} onSaved={() => {}} />}
        {helpOpen && <ShortcutsHelp settings={settings} onClose={() => setHelpOpen(false)} onEdit={() => { setHelpOpen(false); openSettings('shortcuts') }} />}
      </>
    )
  }

  const openTab = (tab: Tab) => {
    setTabs((t) => (t.some((x) => x.key === tab.key) ? t : [...t, tab]))
    setActive(tab.key)
  }
  // Unsaved query tabs and how to save each one (filled in by the tabs)
  /** Close tabs, first asking about unsaved ones unless forced */
  const requestClose = (keys: string[], o: { force?: boolean; includePinned?: boolean } = {}) => {
    const list = keys.filter((k) => o.includePinned || !pinned.has(k))
    const unsaved = o.force ? [] : list.filter((k) => dirtyRef.current[k])
    if (unsaved.length) setConfirmClose({ keys: list, unsaved, includePinned: !!o.includePinned })
    else list.forEach((k) => reallyClose(k, true))
  }
  const closeTab = (key: string, force = false) => requestClose([key], { includePinned: force })
  const reallyClose = (key: string, force = false) => {
    if (pinned.has(key) && !force) return
    delete dirtyRef.current[key]; delete savers.current[key]
    if (side === key) setSide('')
    setPinned((p) => { if (!p.has(key)) return p; const n = new Set(p); n.delete(key); return n })
    const closing = tabsRef.current.find((x) => x.key === key)
    if (closing?.kind === 'query') closedTabs.current = [...closedTabs.current.slice(-19), { title: closing.title, text: texts.current[key] ?? closing.text ?? '' }]
    delete texts.current[key]
    setTabs((t) => {
      const next = t.filter((x) => x.key !== key)
      if (active === key) setActive(next.length ? next[next.length - 1].key : '')
      return next
    })
  }
  const newQuery = () => {
    tabCounter += 1
    openTab({ key: `q${tabCounter}`, kind: 'query', title: `Query ${tabCounter}` })
  }
  /** New query tab pre-filled with a script (Modify, Script as…, Drop…) */
  const openQuery = (title: string, text: string) => {
    tabCounter += 1
    texts.current[`q${tabCounter}`] = text
    openTab({ key: `q${tabCounter}`, kind: 'query', title, text })
  }
  /** Open a script file from disk in a new query tab */
  const openFileTab = async () => {
    try {
      const f = await window.db.openTextFile({ filter: 'SQL script', ext: 'sql' })
      if (!f) return
      tabCounter++
      texts.current[`q${tabCounter}`] = f.content
      openTab({ key: `q${tabCounter}`, kind: 'query', title: f.path.split(/[\\/]/).pop() || 'Script', text: f.content, file: f.path })
    } catch (e) { setStatus((s) => ({ ...s, [active]: `Could not open: ${e instanceof Error ? e.message : String(e)}` })) }
  }
  /** Open a table; `where` opens it filtered (used by foreign-key navigation) */
  const openTable = (table: TableInfo, view?: TableView, where?: string) => {
    const key = `t:${table.schema ?? ''}.${table.name}`
    // Reopening with another view or filter replaces the tab so it shows
    setTabs((t) => (t.some((x) => x.key === key)
      ? t.map((x) => (x.key === key && x.kind === 'table' && ((view && view !== x.view) || where !== undefined) ? { ...x, view: view ?? x.view, where, nonce: Date.now() } : x))
      : [...t, { key, kind: 'table', title: table.name, table, view, where }]))
    setActive(key)
  }
  const newTable = () => {
    tabCounter += 1
    openTab({ key: `n${tabCounter}`, kind: 'newtable', title: 'New table' })
  }
  const openTools = (section: ToolSection) => {
    const titles: Record<ToolSection, string> = { activity: 'Activity', users: 'Users & roles', jobs: 'SQL Agent jobs', backup: 'Backup' }
    setTabs((t) => (t.some((x) => x.key === 'tools')
      ? t.map((x) => (x.key === 'tools' && x.kind === 'tools' ? { ...x, section, title: titles[section], nonce: Date.now() } : x))
      : [...t, { key: 'tools', kind: 'tools', title: titles[section], section }]))
    setActive('tools')
  }
  const openEr = () => openTab({ key: 'er', kind: 'er', title: 'ER diagram' })
  const openCompare = () => openTab({ key: 'compare', kind: 'compare', title: 'Schema compare' })
  const openDataCompare = () => openTab({ key: 'datacompare', kind: 'datacompare', title: 'Data compare' })
  const openNotebook = () => { tabCounter += 1; openTab({ key: `nb${tabCounter}`, kind: 'notebook', title: `Notebook ${tabCounter}` }) }
  const openBuilder = () => { tabCounter += 1; openTab({ key: `qb${tabCounter}`, kind: 'builder', title: 'Query builder' }) }
  const openSearch = () => openTab({ key: 'search', kind: 'search', title: 'Find in database' })
  const openSchedules = () => openTab({ key: 'schedules', kind: 'schedules', title: 'Schedules' })
  const openDashboard = () => openTab({ key: 'dashboard', kind: 'dashboard', title: 'Dashboard' })
  /** Open tabs as plain data (query text included), for a workspace */
  const snapshotTabs = () => {
    const list = tabsRef.current
    return {
      tabs: list.map((t) => { const { key, nonce, ...rest } = t as Tab & { nonce?: number }; void nonce; return (t.kind === 'query' ? { ...rest, text: texts.current[key] ?? (t as { text?: string }).text ?? '' } : rest) as WsTab }),
      active: Math.max(0, list.findIndex((t) => t.key === active))
    }
  }
  const restoreWorkspace = (w: Workspace, replace: boolean) => {
    if (replace && tabsRef.current.some((t) => dirtyRef.current[t.key])) {
      toast.warning('Some tabs have unsaved changes', { description: 'Save or close them first, or use Add to open the workspace next to them.' }); return
    }
    const fresh: Tab[] = w.tabs.map((t) => {
      let key: string
      if (t.kind === 'query') { tabCounter += 1; key = `q${tabCounter}`; texts.current[key] = String(t.text ?? '') }
      else if (t.kind === 'notebook') { tabCounter += 1; key = `nb${tabCounter}` }
      else if (t.kind === 'builder') { tabCounter += 1; key = `qb${tabCounter}` }
      else if (t.kind === 'newtable') { tabCounter += 1; key = `n${tabCounter}` }
      else if (t.kind === 'table') { const ti = t.table as TableInfo; key = `t:${ti.schema ?? ''}.${ti.name}` }
      else key = t.kind === 'tools' ? 'tools' : t.kind
      return { ...t, key } as Tab
    })
    setTabs((cur) => {
      const base = replace ? cur.filter((t) => pinned.has(t.key)) : cur
      return [...base, ...fresh.filter((f) => !base.some((b) => b.key === f.key))]
    })
    setActive(fresh[w.active]?.key ?? fresh[0]?.key ?? '')
    toast.success(`Opened workspace “${w.name}”`, { description: `${fresh.length} tabs` })
  }
  const renameTab = (key: string) => (title: string) => setTabs((l) => l.map((x) => (x.key === key ? { ...x, title } : x)))
  const cycleTab = (dir: 1 | -1) => {
    if (!tabs.length) return
    const i = tabs.findIndex((t) => t.key === active)
    setActive(tabs[(i + dir + tabs.length) % tabs.length].key)
  }
  const actionMap: Partial<Record<ShortcutAction, () => void>> = {
    newQuery,
    newNotebook: () => openNotebook(),
    openFile: () => { openFileTab() },
    palette: () => setPaletteOpen(true),
    settings: () => openSettings(),
    shortcutsHelp: () => setHelpOpen(true),
    closeTab: () => { if (active) closeTab(active) },
    reopenTab: () => { const t = closedTabs.current.pop(); if (t) openQuery(t.title, t.text) },
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    pinTab: () => { if (active) setPinned((p) => { const n = new Set(p); if (n.has(active)) n.delete(active); else n.add(active); return n }) },
    splitRight: () => {
      if (side) { setSide(''); return }
      const i = tabs.findIndex((t) => t.key === active)
      const other = tabs[i + 1] ?? tabs[i - 1]
      if (other) setSide(other.key)
    },
    findInDb: () => openSearch(),
    queryBuilder: () => openBuilder(),
    dataCompare: () => openDataCompare(),
    schemaCompare: () => openCompare(),
    erDiagram: () => openEr(),
    schedules: () => openSchedules(),
    toggleSidebar: () => setSideHidden((h) => !h),
    focusTables: () => { setSideHidden(false); setTimeout(() => (document.querySelector('.sidebar-search input') as HTMLInputElement | null)?.focus(), 50) },
    refreshSchema: () => setSchemaVersion((v) => v + 1),
    toggleTheme: () => toggleTheme()
  }
  keyActions.current = actionMap as Record<string, () => void>
  const hint = (a: ShortcutAction) => shortcutFor(settings, a) || undefined
  const disconnect = async () => {
    await window.db.disconnect(session.id)
    setSession(null)
  }

  const bumpSchema = () => setSchemaVersion((v) => v + 1)
  const dark = theme === 'dark'
  const showSide = !!side && side !== active && tabs.some((t) => t.key === side)
  const sqlLike = queryLanguage(cfg.kind) === 'sql'

  const commands: Command[] = [
    { id: 'new-query', label: 'New query', hint: hint('newQuery'), run: newQuery },
    ...(closedTabs.current.length ? [{ id: 'reopen', label: `Reopen closed tab: ${closedTabs.current[closedTabs.current.length - 1].title}`, hint: hint('reopenTab'), run: actionMap.reopenTab! }] : []),
    ...(sqlLike ? [
      { id: 'notebook', label: 'New notebook', hint: hint('newNotebook'), run: openNotebook },
      { id: 'closeall', label: 'Close all tabs', run: () => requestClose(tabsRef.current.map((t) => t.key)) },
      { id: 'forceclose', label: 'Force close all tabs (discard unsaved changes)', run: () => requestClose(tabsRef.current.map((t) => t.key), { force: true, includePinned: true }) },
      { id: 'builder', label: 'Visual query builder', hint: hint('queryBuilder'), run: openBuilder },
      { id: 'datacompare', label: 'Data compare (rows between two tables)', hint: hint('dataCompare'), run: openDataCompare },
      { id: 'search', label: 'Find in database (search every table)', hint: hint('findInDb'), run: openSearch }
    ] : []),
    ...(sqlLike && session.canEdit ? [{ id: 'new-table', label: 'New table', run: newTable }, { id: 'import-new', label: 'Import a file into a new table (CSV, Excel, JSON)', run: () => setImportNew(true) }] : []),
    { id: 'dashboard', label: 'Dashboard (pinned charts)', run: openDashboard },
    { id: 'workspaces', label: 'Workspaces: save or open a set of tabs', run: () => setWsOpen(true) },
    { id: 'schedules', label: 'Scheduled queries and exports', hint: hint('schedules'), run: openSchedules },
    { id: 'settings', label: 'Settings', hint: hint('settings'), run: () => openSettings() },
    { id: 'tour', label: 'Take the guided tour', run: () => setTimeout(() => startTour({ sqlLike, paletteKey: shortcutFor(settings, 'palette') }), 150) },
    { id: 'shortcuts', label: 'Keyboard shortcuts (list)', hint: hint('shortcutsHelp'), run: () => setHelpOpen(true) },
    { id: 'shortcuts-edit', label: 'Change keyboard shortcuts', run: () => openSettings('shortcuts') },
    { id: 'theme', label: `Switch to ${dark ? 'light' : 'dark'} theme`, hint: hint('toggleTheme'), run: toggleTheme },
    { id: 'sidebar', label: `${sideHidden ? 'Show' : 'Hide'} sidebar`, hint: hint('toggleSidebar'), run: () => setSideHidden((h) => !h) },
    { id: 'refresh', label: 'Refresh tables', hint: hint('refreshSchema'), run: () => setSchemaVersion((v) => v + 1) },
    ...(sqlLike ? [
      { id: 'er', label: 'ER diagram', hint: hint('erDiagram'), run: openEr },
      { id: 'compare', label: 'Schema compare', hint: hint('schemaCompare'), run: openCompare },
      { id: 'activity', label: 'Server activity (sessions, kill)', run: () => openTools('activity') },
      { id: 'users', label: 'Users and roles', run: () => openTools('users') }
    ] : []),
    ...(engine === 'mssql' ? [{ id: 'jobs', label: 'SQL Agent jobs', run: () => openTools('jobs') }] : []),
    { id: 'backup', label: 'Backup and restore script', run: () => openTools('backup') },
    { id: 'disconnect', label: 'Disconnect', run: disconnect },
    ...readSavedQueries().map((q) => ({ id: `saved:${q.id}`, label: `Saved query: ${q.name}`, hint: 'saved', run: () => openQuery(q.name, q.text) })),
    ...teamQueries.map((q, i) => ({ id: `team:${i}:${q.name}`, label: `Team query: ${q.name}`, hint: 'team', run: () => openQuery(q.name, q.text) })),
    ...paletteTables.map((t) => ({ id: `t:${t.schema}.${t.name}`, label: t.schema ? `${t.schema}.${t.name}` : t.name, hint: t.type === 'view' ? 'view' : 'table', run: () => openTable(t) }))
  ]

  const tabIcon = (t: Tab) => t.kind === 'table' || t.kind === 'newtable' ? <IconTable className="tab-ico t" />
    : t.kind === 'tools' ? <IconServer className="tab-ico t" /> : t.kind === 'er' ? <IconDiagram className="tab-ico t" />
    : t.kind === 'compare' || t.kind === 'datacompare' ? <IconCompare className="tab-ico t" />
    : t.kind === 'notebook' ? <IconBook className="tab-ico q" /> : t.kind === 'builder' ? <IconBuilder className="tab-ico q" /> : <IconCode className="tab-ico q" />

  return (
    <ConnContext.Provider value={connValue}>
      <div className={`app ${session.conn.production ? 'is-production' : ''}`}>
        {session.conn.production && (
          <div className="production-bar">PRODUCTION · {session.conn.name || cfg.host} · changes ask for confirmation{session.conn.readOnly ? ' · read-only' : ''}</div>
        )}
        <div className="workspace">
          <nav className="rail" aria-label="Main">
            {(() => {
              const kind = tabs.find((t) => t.key === active)?.kind
              const item = (label: string, icon: JSX.Element, on: boolean, run: () => void, a?: ShortcutAction, show = true) => show && (
                <button className={`rail-btn ${on ? 'on' : ''}`} onClick={run} title={`${label}${a && shortcutFor(settings, a) ? ` (${shortcutFor(settings, a)})` : ''}`} aria-label={label}>{icon}</button>
              )
              return <>
                {item('Tables', <IconDatabase />, !sideHidden, () => setSideHidden((h) => !h), 'toggleSidebar')}
                {item('New query', <IconCode />, kind === 'query', newQuery, 'newQuery')}
                {item('Find in database', <IconSearch />, kind === 'search', openSearch, 'findInDb', sqlLike)}
                {item('Visual query builder', <IconBuilder />, kind === 'builder', openBuilder, 'queryBuilder', sqlLike)}
                {item('New notebook', <IconBook />, kind === 'notebook', openNotebook, 'newNotebook', sqlLike)}
                {item('Data compare', <IconCompare />, kind === 'datacompare' || kind === 'compare', openDataCompare, 'dataCompare', sqlLike)}
                {item('ER diagram', <IconDiagram />, kind === 'er', openEr, 'erDiagram', sqlLike)}
                {item('Scheduled queries', <IconClock />, kind === 'schedules', openSchedules, 'schedules')}
                {item('Dashboard', <IconLayoutDashboard />, kind === 'dashboard', openDashboard)}
                {item('Workspaces', <IconLayers />, wsOpen, () => setWsOpen(true))}
                {item('Server tools', <IconServer />, kind === 'tools', () => openTools(sqlLike ? 'activity' : 'backup'))}
                <div className="rail-spacer" />
                {item('Guided tour', <IconCompass />, false, () => startTour({ sqlLike, paletteKey: shortcutFor(settings, 'palette') }))}
                {item('Keyboard shortcuts', <IconKeyboard />, helpOpen, () => setHelpOpen(true), 'shortcutsHelp')}
                {item(dark ? 'Light theme' : 'Dark theme', dark ? <IconSun /> : <IconMoon />, false, toggleTheme, 'toggleTheme')}
                {item('Settings', <IconGear />, settingsOpen, () => openSettings(), 'settings')}
              </>
            })()}
          </nav>
          <div className="sidebar-wrap" style={{ width: sideW, display: sideHidden ? 'none' : undefined }}>
          <Sidebar
            connId={session.id}
            conn={session.conn}
            onOpenTable={openTable}
            onOpenQuery={openQuery}
            onNewTable={newTable}
            refreshKey={schemaVersion}
            onDisconnect={disconnect}
            onDatabaseChanged={(database) => {
              // Table tabs belong to the old database, so close them; query tabs stay.
              setSession((s) => s && { ...s, conn: { ...s.conn, config: { ...s.conn.config, database } } })
              setTabs((t) => {
                const kept = t.filter((x) => x.kind === 'query' || x.kind === 'tools' || x.kind === 'notebook')
                if (!kept.some((x) => x.key === active)) setActive(kept[0]?.key ?? '')
                return kept
              })
            }}
          />
          <div className="sidebar-resizer" onMouseDown={startResize} onDoubleClick={() => setSideW(280)} title="Drag to resize · double-click to reset" />
          </div>
          <main className="main">
            <div className="tabbar">
              <div className="tabs">
                {[...tabs.filter((t) => pinned.has(t.key)), ...tabs.filter((t) => !pinned.has(t.key))].map((t) => (
                  <div key={t.key} className={`tab ${t.key === active ? 'active' : ''} ${t.key === side ? 'side' : ''} ${pinned.has(t.key) ? 'pinned' : ''}`} onClick={() => setActive(t.key)}
                    onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.key) } }}
                    onContextMenu={(e) => { e.preventDefault(); setTabMenu({ key: t.key, x: e.clientX, y: e.clientY }) }}
                    title={pinned.has(t.key) ? `${t.title} (pinned)` : t.title}>
                    {tabIcon(t)}
                    {!pinned.has(t.key) && <span className="tab-title">{t.title}</span>}
                    {running.has(t.key) && <span className="tab-spinner" title="Running" />}
                    {dirtyRef.current[t.key] && <span className="tab-dirty" title="Unsaved changes">●</span>}
                    {!pinned.has(t.key) && <button className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(t.key) }}><IconX width={12} height={12} /></button>}
                  </div>
                ))}
                <button className="icon-btn new-tab" onClick={newQuery} title={`New query (${shortcutFor(settings, 'newQuery')})`}><IconPlus /></button>
              </div>
              <button className="icon-btn" onClick={() => setPaletteOpen(true)} title={`Command palette (${shortcutFor(settings, 'palette')})`}><IconSearch /></button>
              <div className="menu-wrap">
                <button className="icon-btn" onClick={() => setToolsOpen((o) => !o)} title="Tools"><IconServer /></button>
                {toolsOpen && (
                  <>
                    <div className="menu-backdrop" onClick={() => setToolsOpen(false)} />
                    <div className="menu menu-right" onClick={() => setToolsOpen(false)}>
                      {sqlLike && <button onClick={openEr}><IconDiagram width={14} height={14} /> ER diagram</button>}
                      {sqlLike && <button onClick={openNotebook}><IconBook width={14} height={14} /> New notebook</button>}
                      {sqlLike && <button onClick={openBuilder}><IconBuilder width={14} height={14} /> Visual query builder</button>}
                      {sqlLike && <button onClick={openCompare}><IconCompare width={14} height={14} /> Schema compare</button>}
                      {sqlLike && <button onClick={openDataCompare}><IconRows width={14} height={14} /> Data compare</button>}
                      {sqlLike && <button onClick={openSearch}><IconSearch width={14} height={14} /> Find in database</button>}
                      {sqlLike && session.canEdit && <button onClick={() => setImportNew(true)}><IconUpload width={14} height={14} /> Import file to new table</button>}
                      <button onClick={openSchedules}><IconClock width={14} height={14} /> Scheduled queries</button>
                      <button onClick={openDashboard}><IconLayoutDashboard width={14} height={14} /> Dashboard</button>
                      <button onClick={() => setWsOpen(true)}><IconLayers width={14} height={14} /> Workspaces</button>
                      {sqlLike && <button onClick={() => openTools('activity')}><IconActivity width={14} height={14} /> Activity monitor</button>}
                      {sqlLike && <button onClick={() => openTools('users')}><IconUsers width={14} height={14} /> Users and roles</button>}
                      {engine === 'mssql' && <button onClick={() => openTools('jobs')}><IconJobs width={14} height={14} /> SQL Agent jobs</button>}
                      <button onClick={() => openTools('backup')}><IconBackup width={14} height={14} /> Backup and restore</button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {tabs.length === 0 && (
              <div className="empty-state">
                <IconCode width={40} height={40} />
                <p>Open a table from the sidebar, or start a new query.</p>
                <button className="btn btn-primary" onClick={newQuery}><IconPlus /> New query</button>
                <p className="muted small-text">Ctrl+K finds any table or command.</p>
              </div>
            )}
            <div className="panes">
            {tabs.map((t) => (
              <div key={t.key} className={`tabpanel ${t.key === active ? 'active' : ''} ${showSide && t.key === side ? 'side-pane' : ''}`} style={{ display: t.key === active || (showSide && t.key === side) ? 'flex' : 'none', order: t.key === active ? 0 : 1 }}>
                {showSide && t.key === side && <div className="side-head"><span>{t.title}</span><span className="spacer" /><button className="btn btn-sm" onClick={() => setActive(t.key)} title="Make this the main tab">Focus</button><button className="icon-btn" onClick={() => setSide('')} title="Close split"><IconX width={12} height={12} /></button></div>}
                {t.kind === 'query' && (
                  <QueryTab connId={session.id} database={cfg.database} dark={dark} language={queryLanguage(cfg.kind)} dialect={engine}
                    title={t.title} initialText={texts.current[t.key] ?? t.text} onStatus={statusFor(t.key)} onRunningChange={runningFor(t.key)}
                    onSchemaChanged={bumpSchema} onTextChange={textFor(t.key)} filePath={t.file}
                    onDirty={(d) => { dirtyRef.current[t.key] = d; setDirtyTick((n) => n + 1) }} registerSave={(fn) => { savers.current[t.key] = fn }}
                    onFile={(p) => setTabs((ts) => { const n = ts.map((x) => (x.key === t.key ? { ...x, title: p.split(/[\\/]/).pop() || x.title, file: p } : x)); persistTabs(n); return n })} />
                )}
                {t.kind === 'table' && (
                  <TableTab key={t.nonce ?? 0} connId={session.id} table={t.table} canEdit={session.canEdit} engine={engine} dark={dark}
                    initialView={t.view} initialWhere={t.where} onStatus={statusFor(t.key)} onOpenQuery={openQuery} onSchemaChanged={bumpSchema}
                    onOpenTable={openTable} />
                )}
                {t.kind === 'newtable' && (
                  <TableDesigner connId={session.id} engine={engine} table={null} defaultSchema={({ mssql: 'dbo', postgres: 'public' } as Record<string, string>)[engine]}
                    onStatus={statusFor(t.key)} onOpenQuery={openQuery}
                    onChanged={(table) => { bumpSchema(); closeTab(t.key); openTable(table, 'structure') }} />
                )}
                {t.kind === 'tools' && <ServerTools key={t.nonce ?? 0} initial={t.section} onOpenQuery={openQuery} onStatus={statusFor(t.key)} />}
                {t.kind === 'er' && <ErDiagram onOpenTable={(tb) => openTable(tb)} />}
                {t.kind === 'compare' && <SchemaCompare dark={dark} onStatus={statusFor(t.key)} />}
                {t.kind === 'datacompare' && <DataCompare dark={dark} onStatus={statusFor(t.key)} />}
                {t.kind === 'notebook' && <Notebook connId={session.id} dark={dark} title={t.title} onTitle={renameTab(t.key)} onStatus={statusFor(t.key)} onRunningChange={runningFor(t.key)} />}
                {t.kind === 'search' && <FindInDb onOpenTable={(tb, v, w) => openTable(tb, v as TableView, w)} onStatus={statusFor(t.key)} />}
                {t.kind === 'schedules' && <Schedules dark={dark} onStatus={statusFor(t.key)} />}
                {t.kind === 'dashboard' && <Dashboard onOpenQuery={openQuery} onStatus={statusFor(t.key)} />}
                {t.kind === 'builder' && <QueryBuilder dark={dark} onOpenQuery={openQuery} onStatus={statusFor(t.key)} />}
              </div>
            ))}
            </div>
          </main>
          {importNew && <ImportDialog onClose={() => setImportNew(false)} onDone={(n, t) => { bumpSchema(); openTable(t); setStatus((st) => ({ ...st, [active]: `Imported ${n.toLocaleString()} rows into ${t.name}` })) }} />}
          {confirmClose && (() => {
            const c = confirmClose
            const titleOf = (k: string) => tabs.find((t) => t.key === k)?.title ?? k
            const finish = (keys: string[]) => { setConfirmClose(null); if (c.quit) { window.db.confirmClose(); return } keys.forEach((k) => reallyClose(k, true)) }
            const saveAll = async () => {
              for (const k of c.unsaved) {
                const ok = await savers.current[k]?.()
                if (!ok) { setConfirmClose(null); setActive(k); return } // cancelled: keep the rest open
              }
              finish(c.keys)
            }
            return (
              <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmClose(null) }}
                onKeyDown={(e) => { if (e.key === 'Escape') setConfirmClose(null) }}>
                <div className="modal confirm-close" role="dialog" aria-label="Unsaved changes">
                  <div className="modal-head"><strong>{c.unsaved.length === 1 ? `Save changes to “${titleOf(c.unsaved[0])}”?` : `Save changes to ${c.unsaved.length} tabs?`}</strong></div>
                  <div className="modal-body">
                    <p>{c.unsaved.length === 1 ? 'This query has changes that are not saved to a file.' : 'These queries have changes that are not saved to a file:'}</p>
                    {c.unsaved.length > 1 && <ul className="unsaved-list">{c.unsaved.map((k) => <li key={k}>{titleOf(k)}</li>)}</ul>}
                    <p className="muted small-text">{c.quit ? "Qubase is closing. If you don't save, these changes are lost." : <>If you don't save, the changes are lost (you can still bring the last closed tab back with {shortcutFor(settings, 'reopenTab') || 'Reopen closed tab'}).</>}</p>
                  </div>
                  <div className="modal-foot">
                    <button className="btn" onClick={() => setConfirmClose(null)}>Cancel</button>
                    <span className="spacer" />
                    <button className="btn danger" onClick={() => finish(c.keys)}>{c.quit ? "Don't save, close Qubase" : "Don't save"}</button>
                    <button className="btn btn-primary" autoFocus onClick={saveAll}>{c.unsaved.length === 1 ? 'Save' : 'Save all'}</button>
                  </div>
                </div>
              </div>
            )
          })()}
          {tabMenu && (() => {
            const k = tabMenu.key
            const close = () => setTabMenu(null)
            return (
              <>
                <div className="menu-backdrop" onClick={close} onContextMenu={(e) => { e.preventDefault(); close() }} />
                <div className="menu tab-menu" style={{ left: tabMenu.x, top: tabMenu.y }} onClick={close}>
                  <button onClick={() => setPinned((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })}>{pinned.has(k) ? 'Unpin tab' : 'Pin tab'}</button>
                  {k !== active && <button onClick={() => setSide(k)}>Open to the side</button>}
                  {k === active && tabs.length > 1 && <button onClick={() => setSide(tabs.find((t) => t.key !== k)!.key)}>Split with another tab</button>}
                  {side && <button onClick={() => setSide('')}>Close split</button>}
                  {!pinned.has(k) && <button onClick={() => closeTab(k)}>Close</button>}
                  <button onClick={() => requestClose(tabs.filter((t) => t.key !== k).map((t) => t.key))}>Close other tabs</button>
                  <button onClick={() => requestClose(tabs.filter((t) => !dirtyRef.current[t.key]).map((t) => t.key))}>Close saved tabs</button>
                  <button onClick={() => requestClose(tabs.map((t) => t.key))}>Close all tabs</button>
                  <div className="menu-sep" />
                  <button className="danger-text" onClick={() => requestClose(tabs.map((t) => t.key), { force: true, includePinned: true })}>Force close all (discard unsaved changes)</button>
                </div>
              </>
            )
          })()}
        </div>
        <footer className="statusbar" style={session.conn.color ? { background: session.conn.color } : undefined}>
          <span className="dot" /> Connected · {driverFor(cfg.kind).label}
          {cfg.host && <span> · {cfg.host}{cfg.port ? `:${cfg.port}` : ''}</span>}
          {cfg.ssh?.enabled && <span> · via SSH {cfg.ssh.host}</span>}
          {cfg.database && <span> · {cfg.database}</span>}
          {session.conn.readOnly && <span className="status-pill">Read-only</span>}
          <span className="spacer" />
          <span>{status[active] ?? ''}</span>
        </footer>
        {settingsOpen && <SettingsModal section={settingsAt} onClose={() => setSettingsOpen(false)} onSaved={() => {}} />}
        {helpOpen && <ShortcutsHelp settings={settings} onClose={() => setHelpOpen(false)} onEdit={() => { setHelpOpen(false); openSettings('shortcuts') }} />}
        {wsOpen && <WorkspacesModal connId={session.conn.id} current={snapshotTabs} onOpen={restoreWorkspace} onClose={() => setWsOpen(false)} />}
        <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors closeButton duration={3500} offset={36} toastOptions={{ className: 'qb-toast' }} />
        {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      </div>
    </ConnContext.Provider>
  )
}
