import { useEffect, useMemo, useState } from 'react'
import type { ColumnInfo, DbObject, ObjectKind, SavedConnection, TableInfo } from '../../shared/types'
import { driverFor } from '../../shared/drivers'
import { scriptDelete, scriptDrop, scriptExecute, scriptInsert, scriptSelect, scriptTruncate, scriptUpdate } from '../../shared/ddl'
import { DbBadge } from './DbBadge'
import { ContextMenu, MenuItem } from './ContextMenu'
import {
  IconCheck, IconChevron, IconCode, IconColumn, IconCopy, IconDatabase, IconKey, IconPlus,
  IconPower, IconRefresh, IconSearch, IconTable, IconView
} from './Icons'
import { errMsg } from '../util'

export type TableView = 'data' | 'structure' | 'script'

interface Props {
  connId: string
  conn: SavedConnection
  onOpenTable: (t: TableInfo, view?: TableView) => void
  /** Open a new query tab with this text */
  onOpenQuery: (title: string, text: string) => void
  onNewTable: () => void
  onDisconnect: () => void
  /** Called after switching to another database on the same server */
  onDatabaseChanged: (database: string) => void
  /** Bumped by the app after DDL runs, so the tree reloads */
  refreshKey?: number
}

type Category = 'tables' | 'views' | ObjectKind
const CATEGORY_LABEL: Record<Category, string> = {
  tables: 'Tables', views: 'Views', matview: 'Materialized views', procedure: 'Stored procedures', function: 'Functions',
  trigger: 'Triggers', sequence: 'Sequences', event: 'Events', package: 'Packages', type: 'Types', synonym: 'Synonyms', index: 'Indexes'
}
const SINGULAR: Record<Category, string> = {
  tables: 'table', views: 'view', matview: 'materialized view', procedure: 'procedure', function: 'function',
  trigger: 'trigger', sequence: 'sequence', event: 'event', package: 'package', type: 'type', synonym: 'synonym', index: 'index'
}
const CATEGORY_ORDER: Category[] = ['tables', 'views', 'matview', 'procedure', 'function', 'package', 'trigger', 'event', 'sequence', 'index', 'type', 'synonym']

const tKey = (t: { schema?: string; name: string }) => `${t.schema ?? ''}.${t.name}`
type Entry = { kind: 'table'; t: TableInfo } | { kind: 'object'; o: DbObject }

export function Sidebar({ connId, conn, onOpenTable, onOpenQuery, onNewTable, onDisconnect, onDatabaseChanged, refreshKey }: Props) {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [objects, setObjects] = useState<DbObject[]>([])
  const [dbs, setDbs] = useState<{ databases: string[]; current: string } | null>(null)
  const [switching, setSwitching] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Collapsed schemas; categories: Tables start open, the rest closed
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set())
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [closedTables, setClosedTables] = useState<Set<string>>(new Set())
  const [openTables, setOpenTables] = useState<Record<string, ColumnInfo[] | 'loading'>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const engine = driverFor(conn.config.kind).engine
  const isSql = engine !== 'mongodb' && engine !== 'redis'

  /** Copy a name; Shift+click copies it with the schema (e.g. dbo.Orders). */
  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200)
  }
  const CopyBtn = ({ k, name, full }: { k: string; name: string; full: string }) => (
    <button className={`icon-btn copy-btn ${copied === k ? 'done' : ''}`} title="Copy name (Shift+click copies it with the schema)"
      onClick={(e) => { e.stopPropagation(); copyText(k, e.shiftKey ? full : name) }} onDoubleClick={(e) => e.stopPropagation()}>
      {copied === k ? <IconCheck /> : <IconCopy />}
    </button>
  )

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [list, databases, objs] = await Promise.all([
        window.db.listTables(connId),
        window.db.listDatabases(connId).catch(() => null),
        isSql ? window.db.listObjects(connId).catch(() => [] as DbObject[]) : Promise.resolve([] as DbObject[])
      ])
      setTables(list)
      setDbs(databases)
      setObjects(objs.filter((o) => o.kind))
    } catch (e) { setError(errMsg(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [connId, refreshKey])

  const switchDb = async (name: string) => {
    if (!dbs || name === dbs.current) return
    setSwitching(true); setError('')
    try {
      await window.db.switchDatabase(connId, name)
      setOpenTables({}); setCollapsedSchemas(new Set()); setFilter('')
      onDatabaseChanged(name)
      await load()
    } catch (e) { setError(errMsg(e)) } finally { setSwitching(false) }
  }

  // schema → category → entries
  const tree = useMemo(() => {
    const f = filter.toLowerCase()
    const m = new Map<string, Map<Category, Entry[]>>()
    const add = (schema: string, cat: Category, e: Entry) => {
      if (!m.has(schema)) m.set(schema, new Map())
      const cats = m.get(schema)!
      if (!cats.has(cat)) cats.set(cat, [])
      cats.get(cat)!.push(e)
    }
    for (const t of tables) if (!f || t.name.toLowerCase().includes(f)) add(t.schema ?? '', t.type === 'view' ? 'views' : 'tables', { kind: 'table', t })
    for (const o of objects) if (!f || o.name.toLowerCase().includes(f)) add(o.schema ?? '', o.kind, { kind: 'object', o })
    return [...m.entries()].map(([schema, cats]) => [schema, CATEGORY_ORDER.filter((c) => cats.has(c)).map((c) => [c, cats.get(c)!] as const)] as const)
  }, [tables, objects, filter])

  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, v: T) =>
    set((c) => { const n = new Set(c); n.has(v) ? n.delete(v) : n.add(v); return n })

  const toggleTable = async (t: TableInfo) => {
    const k = tKey(t)
    if (openTables[k]) { setOpenTables((o) => { const n = { ...o }; delete n[k]; return n }); return }
    setOpenTables((o) => ({ ...o, [k]: 'loading' }))
    try {
      const cols = await window.db.listColumns(connId, t)
      setOpenTables((o) => ({ ...o, [k]: cols }))
    } catch (e) {
      setError(errMsg(e))
      setOpenTables((o) => { const n = { ...o }; delete n[k]; return n })
    }
  }

  // ---- scripts for the right-click menu ----
  const openDefinition = async (title: string, target: Parameters<typeof window.db.getDefinition>[1]) => {
    try { onOpenQuery(title, await window.db.getDefinition(connId, target)) } catch (e) { setError(errMsg(e)) }
  }
  const withColumns = async (t: TableInfo, make: (cols: ColumnInfo[]) => string, title: string) => {
    try { onOpenQuery(title, make(await window.db.listColumns(connId, t))) } catch (e) { setError(errMsg(e)) }
  }

  const tableMenu = (t: TableInfo): MenuItem[] => {
    const full = t.schema ? `${t.schema}.${t.name}` : t.name
    const view = t.type === 'view'
    const items: MenuItem[] = [
      { label: 'Open data', onClick: () => onOpenTable(t, 'data') },
      { label: view ? 'Columns' : 'Design table', onClick: () => onOpenTable(t, 'structure') }
    ]
    if (isSql) {
      items.push('sep',
        { label: view ? 'Script: Modify view' : 'Script: CREATE', onClick: () => openDefinition(t.name, { ...t, kind: view ? 'view' : 'table' }) },
        { label: 'Script: SELECT', onClick: () => withColumns(t, (c) => scriptSelect(engine, t, c.map((x) => x.name)), `SELECT ${t.name}`) })
      if (!view) {
        items.push(
          { label: 'Script: INSERT', onClick: () => withColumns(t, (c) => scriptInsert(engine, t, c), `INSERT ${t.name}`) },
          { label: 'Script: UPDATE', onClick: () => withColumns(t, (c) => scriptUpdate(engine, t, c), `UPDATE ${t.name}`) },
          { label: 'Script: DELETE', onClick: () => withColumns(t, (c) => scriptDelete(engine, t, c), `DELETE ${t.name}`) })
      }
    }
    items.push('sep',
      { label: 'Copy name', onClick: () => copyText(tKey(t), t.name) },
      { label: 'Copy full name', onClick: () => copyText(tKey(t), full) })
    if (isSql) {
      items.push('sep')
      if (!view) items.push({ label: 'New table…', onClick: onNewTable })
      if (!view) items.push({ label: 'Truncate…', danger: true, hint: 'opens script', onClick: () => onOpenQuery(`TRUNCATE ${t.name}`, `-- Removes ALL rows from ${full}. Review, then run.\n${scriptTruncate(engine, t)}`) })
      items.push({ label: view ? 'Drop view…' : 'Drop table…', danger: true, hint: 'opens script', onClick: () => onOpenQuery(`DROP ${t.name}`, `-- Deletes ${full} permanently. Review, then run.\n${scriptDrop(engine, view ? 'view' : 'table', t)}`) })
    }
    return items
  }

  const objectMenu = (o: DbObject): MenuItem[] => {
    const editable = o.kind === 'procedure' || o.kind === 'function' || o.kind === 'trigger' || o.kind === 'package' || o.kind === 'event'
    const items: MenuItem[] = [{ label: editable ? 'Modify' : 'Script: CREATE', onClick: () => openDefinition(o.name, o) }]
    if (o.kind === 'procedure' || o.kind === 'function') items.push({ label: 'Execute…', hint: 'opens script', onClick: () => onOpenQuery(`EXEC ${o.name}`, scriptExecute(engine, o.kind, o)) })
    items.push('sep',
      { label: 'Copy name', onClick: () => copyText(`o:${o.kind}:${tKey(o)}`, o.name) },
      'sep',
      { label: `Drop ${SINGULAR[o.kind]}…`, danger: true, hint: 'opens script', onClick: () => onOpenQuery(`DROP ${o.name}`, `-- Review, then run.\n${scriptDrop(engine, o.kind, o, o.table)}`) })
    return items
  }

  const showMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault(); e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const title = conn.name || conn.config.database || conn.config.file?.split(/[\\/]/).pop() || driverFor(conn.config.kind).label
  const showSchemaHeaders = tree.length > 1 || (tree.length === 1 && tree[0][0] !== '')
  // MongoDB / Redis only have collections or keys: skip the category header
  const flat = !isSql

  const renderTable = (t: TableInfo, depth: number) => {
    const k = tKey(t)
    const cols = openTables[k]
    return (
      <div key={k}>
        <div className={`tree-row table-row d${depth}`} onDoubleClick={() => onOpenTable(t)} onContextMenu={(e) => showMenu(e, tableMenu(t))} title="Double-click to open · right-click for more">
          <span className="chev-btn" onClick={() => toggleTable(t)}><IconChevron className={`chev ${cols ? 'open' : ''}`} /></span>
          {t.type === 'view' ? <IconView className="ico view" /> : <IconTable className="ico table" />}
          <span className="tname">{t.name}</span>
          <CopyBtn k={k} name={t.name} full={t.schema ? `${t.schema}.${t.name}` : t.name} />
        </div>
        {cols === 'loading' && <div className={`tree-row col-row d${depth + 1} muted`}>Loading…</div>}
        {Array.isArray(cols) && cols.map((c) => (
          <div key={c.name} className={`tree-row col-row d${depth + 1}`}>
            {c.primaryKey ? <IconKey className="ico key" /> : <IconColumn className="ico col" />}
            <span className="cname">{c.name}</span>
            <span className="ctype">{c.dataType}</span>
            <CopyBtn k={`${k}#${c.name}`} name={c.name} full={`${t.name}.${c.name}`} />
          </div>
        ))}
      </div>
    )
  }

  const renderObject = (o: DbObject, depth: number) => {
    const k = `o:${o.kind}:${tKey(o)}:${o.table ?? ''}`
    return (
      <div key={k} className={`tree-row obj-row d${depth}`} onDoubleClick={() => openDefinition(o.name, o)} onContextMenu={(e) => showMenu(e, objectMenu(o))}
        title={`${o.table ? `On ${o.table} · ` : ''}Double-click to open the script · right-click for more`}>
        <IconCode className={`ico obj ${o.kind}`} />
        <span className="tname">{o.name}</span>
        {o.table && <span className="ctype">{o.table}</span>}
        <CopyBtn k={`o:${o.kind}:${tKey(o)}`} name={o.name} full={o.schema ? `${o.schema}.${o.name}` : o.name} />
      </div>
    )
  }

  return (
    <aside className="sidebar" style={conn.color ? { borderTop: `3px solid ${conn.color}` } : undefined}>
      <div className="sidebar-head">
        <DbBadge kind={conn.config.kind} size={26} />
        <div className="sidebar-title">
          <div className="name" title={title}>{title}</div>
          <div className="sub">{driverFor(conn.config.kind).label}{conn.config.host ? ` · ${conn.config.host}` : ''}</div>
        </div>
        <button className="icon-btn" title="Disconnect" onClick={onDisconnect}><IconPower /></button>
      </div>

      {dbs && dbs.databases.length > 0 && (
        <div className="db-picker">
          <IconDatabase className="db-picker-icon" />
          <select value={dbs.current} disabled={switching} onChange={(e) => switchDb(e.target.value)} title="Switch database">
            {!dbs.databases.includes(dbs.current) && <option value={dbs.current}>{dbs.current || '(none)'}</option>}
            {dbs.databases.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      <div className="sidebar-search">
        <IconSearch className="search-icon" />
        <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {isSql && <button className="icon-btn" title="New table" onClick={onNewTable}><IconPlus /></button>}
        <button className={`icon-btn ${loading ? 'spin' : ''}`} title="Refresh" onClick={load}><IconRefresh /></button>
      </div>

      {error && <div className="notice error small" onClick={() => setError('')} title="Click to dismiss">{error}</div>}

      <div className="tree">
        {!loading && tables.length === 0 && objects.length === 0 && !error && <div className="empty pad">No tables found</div>}
        {tree.map(([schema, cats]) => {
          const schemaCollapsed = collapsedSchemas.has(schema)
          const base = showSchemaHeaders ? 1 : 0
          return (
            <div key={schema}>
              {showSchemaHeaders && (
                <div className="tree-row schema-row" onClick={() => toggle(setCollapsedSchemas, schema)}>
                  <IconChevron className={`chev ${schemaCollapsed ? '' : 'open'}`} />
                  <span>{schema || 'default'}</span>
                  <span className="count">{cats.reduce((n, [, l]) => n + l.length, 0)}</span>
                </div>
              )}
              {!schemaCollapsed && cats.map(([cat, list]) => {
                const ck = `${schema}/${cat}`
                // A filter opens every category so matches are visible
                const open = filter ? true : cat === 'tables' ? !closedTables.has(ck) : openCats.has(ck)
                const depth = flat ? base : base + 1
                return (
                  <div key={cat}>
                    {!flat && (
                      <div className={`tree-row cat-row d${base}`}
                        onClick={() => cat === 'tables' ? toggle(setClosedTables, ck) : toggle(setOpenCats, ck)}
                        onContextMenu={(e) => { if (cat === 'tables' && isSql) showMenu(e, [{ label: 'New table…', onClick: onNewTable }, { label: 'Refresh', onClick: load }]) }}>
                        <IconChevron className={`chev ${open ? 'open' : ''}`} />
                        <span>{CATEGORY_LABEL[cat]}</span>
                        <span className="count">{list.length}</span>
                      </div>
                    )}
                    {open && list.map((e) => (e.kind === 'table' ? renderTable(e.t, depth) : renderObject(e.o, depth)))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}
