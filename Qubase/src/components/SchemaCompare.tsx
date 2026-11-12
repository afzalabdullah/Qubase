import { readSettings } from '../settings'
import { editorTheme } from '../editorThemes'
import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlLang } from '@codemirror/lang-sql'
import type { SavedConnection, TableInfo, TableStructure } from '../../shared/types'
import { alterTableSql, createIndexSql, createTableSql, DesignColumn, quote, tableRef } from '../../shared/ddl'
import { driverFor } from '../../shared/drivers'
import { IconCopy } from './Icons'
import { Combo, useTargetCatalog } from './Combo'
import { errMsg } from '../util'
import { allowRun, checkSql } from '../safety'
import { useConn } from '../settings'
import { toast } from 'sonner'
import { deleteSnapshot, listSnapshots, saveSnapshot, Snapshot, takeSnapshot } from '../snapshots'

interface Diff {
  table: string
  kind: 'missing' | 'extra' | 'changed'
  notes: string[]
}

const keyOf = (t: { schema?: string; name: string }) => `${t.schema ?? ''}.${t.name}`.toLowerCase()

/**
 * Compare this connection's tables with another saved connection and build the
 * script that makes the other one match (this one is the source of truth).
 */
export function SchemaCompare({ dark, onStatus }: { dark: boolean; onStatus: (s: string) => void }) {
  const { conn, connId, engine } = useConn()
  const [saved, setSaved] = useState<SavedConnection[]>([])
  const [targetId, setTargetId] = useState('')
  const [targetDb, setTargetDb] = useState('')
  const [diffs, setDiffs] = useState<Diff[] | null>(null)
  const [script, setScript] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [snaps, setSnaps] = useState<Snapshot[]>(() => listSnapshots(conn.id))
  const [snapMenu, setSnapMenu] = useState(false)
  const [snapName, setSnapName] = useState('')
  const snap = targetId.startsWith('snap:') ? snaps.find((x) => `snap:${x.id}` === targetId) : undefined

  useEffect(() => { window.db.listSaved().then((l) => setSaved(l.filter((c) => driverFor(c.config.kind).engine === engine))).catch(() => {}) }, [engine])
  const target = snap ? undefined : saved.find((c) => c.id === targetId)
  // Only the database list is needed here; tables are read when comparing
  const cat = useTargetCatalog(connId, target, false, '')

  const compare = async () => {
    if (!target && !snap) return
    setBusy('Connecting…'); setError(''); setDiffs(null); setScript('')
    let tid = ''
    try {
      // The other side: a live connection, or a saved snapshot
      const snapMap = new Map((snap?.tables ?? []).map((x) => [keyOf(x.t), x.s]))
      if (target) tid = (await window.db.connect({ ...target.config, database: targetDb || target.config.database })).id
      const otherStructure = (t: TableInfo) => (snap ? Promise.resolve(snapMap.get(keyOf(t))!) : window.db.getStructure(tid, t))
      setBusy('Reading tables…')
      const [src, dst] = await Promise.all([window.db.listTables(connId), snap ? Promise.resolve(snap.tables.map((x) => x.t)) : window.db.listTables(tid)])
      const srcT = src.filter((t) => t.type !== 'view'), dstT = dst.filter((t) => t.type !== 'view')
      const dstMap = new Map(dstT.map((t) => [keyOf(t), t]))
      const srcKeys = new Set(srcT.map(keyOf))
      const out: Diff[] = []
      const lines: string[] = snap
        ? [`-- Changes since snapshot "${snap.name}" (${new Date(snap.at).toLocaleString()})`, '-- Running this on a database that still has the snapshot\'s schema brings it up to date.', `-- Generated ${new Date().toLocaleString()}. Review before running.`, '']
        : [`-- Makes "${target!.name}${targetDb ? ` / ${targetDb}` : ''}" match "${conn.name || 'this connection'}"`, `-- Generated ${new Date().toLocaleString()}. Review before running.`, '']
      let n = 0
      for (const t of srcT) {
        setBusy(`Comparing ${++n} / ${srcT.length}: ${t.name}`)
        const other = dstMap.get(keyOf(t))
        const s = await window.db.getStructure(connId, t)
        if (!other) {
          out.push({ table: label(t), kind: 'missing', notes: [snap ? 'Created since the snapshot' : 'Table does not exist in the target'] })
          lines.push(`-- New table ${label(t)}`, createTableSql(engine, t, s), '')
          for (const ix of s.indexes.filter((i) => !i.primary)) lines.push(createIndexSql(engine, t, ix.name, ix.columns, ix.unique))
          continue
        }
        const d = await otherStructure(other)
        const { notes, sql } = tableDiff(engine, other, s, d)
        if (notes.length) {
          out.push({ table: label(t), kind: 'changed', notes })
          lines.push(`-- Changes to ${label(t)}`, ...sql, '')
        }
      }
      for (const t of dstT) {
        if (srcKeys.has(keyOf(t))) continue
        out.push({ table: label(t), kind: 'extra', notes: [snap ? 'Dropped since the snapshot (the DROP is commented out)' : 'Only in the target (left alone; the DROP is commented out)'] })
        lines.push(`-- DROP TABLE ${tableRef(engine, t)};`)
      }
      setDiffs(out)
      setScript(out.length ? lines.join('\n') : '-- The schemas match')
      onStatus(`${out.length} difference${out.length === 1 ? '' : 's'}`)
    } catch (e) { setError(errMsg(e)) } finally {
      if (tid) window.db.disconnect(tid).catch(() => {})
      setBusy('')
    }
  }

  const take = async () => {
    setSnapMenu(false); setError('')
    try {
      const name = snapName.trim() || `Snapshot ${new Date().toLocaleString()}`
      const sn = await takeSnapshot(connId, name, engine, conn.name || '', (d, t) => setBusy(`Snapshot: ${d} / ${t} tables`))
      setSnaps(saveSnapshot(conn.id, sn)); setSnapName('')
      onStatus(`Snapshot “${name}” saved (${sn.tables.length} tables)`); toast.success(`Snapshot “${name}” saved`, { description: `${sn.tables.length} tables` })
    } catch (e) { setError(errMsg(e)) } finally { setBusy('') }
  }
  const exportSnap = async (sn: Snapshot) => {
    const p = await window.db.saveTextFile(JSON.stringify({ app: 'qubase', kind: 'schema-snapshot', version: 1, snapshot: sn }), { name: sn.name.replace(/[^\w -]/g, '_'), filter: 'Qubase schema snapshot', ext: 'json' })
    if (p) onStatus(`Snapshot saved to ${p}`)
  }
  const importSnap = async () => {
    setSnapMenu(false)
    try {
      const f = await window.db.openTextFile({ filter: 'Qubase schema snapshot', ext: 'json' })
      if (!f) return
      const d = JSON.parse(f.content)
      const sn: Snapshot = d.snapshot ?? d
      if (!Array.isArray(sn?.tables)) throw new Error('This file is not a Qubase schema snapshot')
      if (sn.engine && sn.engine !== engine) throw new Error(`This snapshot is from a ${sn.engine} database; this connection is ${engine}`)
      const copy = { ...sn, id: crypto.randomUUID() }
      setSnaps(saveSnapshot(conn.id, copy)); setTargetId(`snap:${copy.id}`)
      onStatus(`Loaded snapshot “${sn.name}”`)
    } catch (e) { setError(`Could not load: ${errMsg(e)}`) }
  }

  const runOnTarget = async () => {
    if (!target || !script.trim()) return
    if (!allowRun(target, checkSql(script, 'sql'))) return
    if (!target.production && !window.confirm(`Run the script on "${target.name}"?`)) return
    setBusy('Running on target…'); setError('')
    let tid = ''
    try {
      tid = (await window.db.connect({ ...target.config, database: targetDb || target.config.database })).id
      // One statement at a time, so a failure says which one
      const stmts = script.split(/;\s*\n/).map((s) => s.replace(/^(\s*--[^\n]*\n)*/g, '').trim()).filter((s) => s && !s.startsWith('--'))
      let done = 0
      for (const s of stmts) { await window.db.queryMulti(tid, s + (/;$/.test(s) ? '' : ';')); done++ }
      onStatus(`Ran ${done} statements on ${target.name}`)
      await compare()
    } catch (e) { setError(errMsg(e)) } finally {
      if (tid) window.db.disconnect(tid).catch(() => {})
      setBusy('')
    }
  }

  return (
    <div className="compare-view">
      <div className="toolbar">
        <div className="crumb"><strong>Schema compare</strong> <span className="muted">· this connection is the source</span></div>
        <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setTargetDb('') }}>
          <option value="">Target connection…</option>
          {saved.length > 0 && <optgroup label="Connections">{saved.map((c) => <option key={c.id} value={c.id}>{c.name || c.config.host || c.config.file}{c.production ? ' (Production)' : ''}</option>)}</optgroup>}
          {snaps.length > 0 && <optgroup label="Snapshots of this connection">{snaps.map((x) => <option key={x.id} value={`snap:${x.id}`}>📷 {x.name} · {new Date(x.at).toLocaleDateString()}</option>)}</optgroup>}
        </select>
        <div className="menu-wrap">
          <button className="btn btn-sm" onClick={() => setSnapMenu((m) => !m)} disabled={!!busy} title="Save this schema now, to see later what changed">Snapshots ▾</button>
          {snapMenu && (
            <>
              <div className="menu-backdrop" onClick={() => setSnapMenu(false)} />
              <div className="menu snap-menu">
                <form className="snap-take" onSubmit={(e) => { e.preventDefault(); take() }}>
                  <input value={snapName} onChange={(e) => setSnapName(e.target.value)} placeholder="Name, e.g. Before release 2.4" autoFocus />
                  <button className="btn btn-sm btn-primary" type="submit">Take snapshot</button>
                </form>
                <button onClick={importSnap}>Load a snapshot file…</button>
                {snaps.length > 0 && <div className="menu-sep" />}
                {snaps.map((x) => (
                  <div key={x.id} className="snap-item">
                    <button className="snap-pick" onClick={() => { setTargetId(`snap:${x.id}`); setSnapMenu(false) }} title="Compare with this snapshot">
                      <strong>{x.name}</strong><span className="muted small-text">{new Date(x.at).toLocaleString()} · {x.tables.length} tables</span>
                    </button>
                    <button className="icon-btn" title="Save to a file (to share or keep in source control)" onClick={() => exportSnap(x)}>⤓</button>
                    <button className="icon-btn" title="Delete" onClick={() => { if (window.confirm(`Delete snapshot “${x.name}”?`)) { setSnaps(deleteSnapshot(conn.id, x.id)); if (targetId === `snap:${x.id}`) setTargetId('') } }}>✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {target && driverFor(target.config.kind).mode === 'server' && (
          <Combo value={targetDb} options={cat.databases} width={200} placeholder={target.config.database || 'Default database'} title="Target database (empty = the connection's default)"
            loading={cat.loading} onChange={setTargetDb} />
        )}
        <button className="btn btn-sm btn-primary" disabled={(!target && !snap) || !!busy} onClick={compare}>{snap ? 'What changed?' : 'Compare'}</button>
        <div className="spacer" />
        {busy && <span className="muted small-text">{busy}</span>}
        <button className="btn btn-sm" disabled={!script} onClick={() => navigator.clipboard?.writeText(script)}><IconCopy width={13} height={13} /> Copy script</button>
        {!snap && <button className="btn btn-sm" disabled={!diffs?.length || !!busy} onClick={runOnTarget}>Run on target</button>}
      </div>
      {!saved.length && !snaps.length && <div className="notice">Save another {driverFor(conn.config.kind).label} connection to compare two databases, or take a snapshot (Snapshots ▾) to see later what changed in this one.</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="compare-body">
        <div className="compare-list">
          {diffs === null && <div className="placeholder">Pick a connection or a snapshot, then press Compare.</div>}
          {diffs?.length === 0 && <div className="placeholder ok">✓ {snap ? 'Nothing changed since the snapshot' : 'No differences'} in tables, columns or indexes.</div>}
          {diffs?.map((d) => (
            <div key={d.table} className={`diff ${d.kind}`}>
              <div><span className={`diff-tag ${d.kind}`}>{d.kind === 'missing' ? 'New' : d.kind === 'extra' ? (snap ? 'Dropped' : 'Only in target') : 'Changed'}</span> <strong>{d.table}</strong></div>
              <ul>{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          ))}
        </div>
        <div className="compare-script">
          <CodeMirror value={script} height="100%" theme={editorTheme(readSettings().editorTheme, dark)} extensions={[sqlLang()]} onChange={setScript} basicSetup={{ foldGutter: false }} />
        </div>
      </div>
    </div>
  )
}

const label = (t: TableInfo) => (t.schema ? `${t.schema}.${t.name}` : t.name)

/** Column and index differences for one table, and the ALTER statements that fix them. */
function tableDiff(engine: string, t: TableInfo, src: TableStructure, dst: TableStructure) {
  const notes: string[] = []
  const sql: string[] = []
  const dstCols = new Map(dst.columns.map((c) => [c.name.toLowerCase(), c]))
  const desired: DesignColumn[] = src.columns.map((c) => {
    const o = dstCols.get(c.name.toLowerCase())
    if (!o) notes.push(`Add column ${c.name} ${c.dataType}`)
    else {
      if (o.dataType.toLowerCase() !== c.dataType.toLowerCase()) notes.push(`${c.name}: type ${o.dataType} → ${c.dataType}`)
      if (o.nullable !== c.nullable) notes.push(`${c.name}: ${c.nullable ? 'allow NULL' : 'NOT NULL'}`)
      if ((o.defaultValue ?? '') !== (c.defaultValue ?? '')) notes.push(`${c.name}: default ${o.defaultValue ?? 'none'} → ${c.defaultValue ?? 'none'}`)
    }
    return { ...c, original: o?.name, primaryKey: o ? o.primaryKey : c.primaryKey }
  })
  const alter = alterTableSql(engine, t, dst.columns, desired)
  sql.push(...alter.sql)
  const srcNames = new Set(src.columns.map((c) => c.name.toLowerCase()))
  for (const c of dst.columns) if (!srcNames.has(c.name.toLowerCase())) {
    notes.push(`Extra column ${c.name} in target (DROP commented out)`)
    sql.push(`-- ALTER TABLE ${tableRef(engine, t)} DROP COLUMN ${quote(engine, c.name)};`)
  }
  const dstIx = new Set(dst.indexes.map((i) => `${i.unique}:${i.columns.join(',').toLowerCase()}`))
  for (const ix of src.indexes.filter((i) => !i.primary)) {
    if (dstIx.has(`${ix.unique}:${ix.columns.join(',').toLowerCase()}`)) continue
    notes.push(`Add ${ix.unique ? 'unique ' : ''}index ${ix.name} (${ix.columns.join(', ')})`)
    sql.push(createIndexSql(engine, t, ix.name, ix.columns, ix.unique))
  }
  for (const w of alter.warnings) sql.push(`-- ${w}`)
  return { notes, sql }
}
