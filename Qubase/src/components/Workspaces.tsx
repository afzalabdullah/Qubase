import { useState } from 'react'

export interface WsTab { kind: string; title: string; [k: string]: unknown }
export interface Workspace { id: string; name: string; at: string; tabs: WsTab[]; active: number }

const key = (connId: string) => `workspaces:${connId}`
export function readWorkspaces(connId: string): Workspace[] {
  try { return JSON.parse(localStorage.getItem(key(connId)) ?? '[]') } catch { return [] }
}
function write(connId: string, l: Workspace[]) { try { localStorage.setItem(key(connId), JSON.stringify(l)) } catch { throw new Error('Not enough room to save this workspace.') } }

/** Save the open tabs under a name, and reopen a saved set in one click */
export function WorkspacesModal({ connId, current, onOpen, onClose }: {
  connId: string
  /** The tabs open now, ready to store */
  current: () => { tabs: WsTab[]; active: number }
  onOpen: (w: Workspace, replace: boolean) => void
  onClose: () => void
}) {
  const [list, setList] = useState(() => readWorkspaces(connId))
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const set = (l: Workspace[]) => { try { write(connId, l); setList(l); setError('') } catch (e) { setError((e as Error).message) } }

  const save = (overwrite?: Workspace) => {
    const c = current()
    if (!c.tabs.length) { setError('No tabs are open.'); return }
    const n = overwrite?.name ?? (name.trim() || `Workspace ${list.length + 1}`)
    const w: Workspace = { id: overwrite?.id ?? crypto.randomUUID(), name: n, at: new Date().toISOString(), ...c }
    set([w, ...list.filter((x) => x.id !== w.id && x.name !== n)])
    setName('')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ws-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><strong>Workspaces</strong><span className="spacer" /><button className="icon-btn" onClick={onClose} title="Close">✕</button></div>
        <p className="muted small-text">A workspace is a saved set of tabs for this connection: queries (with their text), tables and tools. Open it later to get them all back.</p>
        <form className="ws-save" onSubmit={(e) => { e.preventDefault(); save() }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Monthly report" autoFocus />
          <button className="btn btn-primary" type="submit">Save open tabs</button>
        </form>
        {error && <div className="notice error">{error}</div>}
        {!list.length && <div className="placeholder">No workspaces saved yet.</div>}
        <ul className="ws-list">
          {list.map((w) => (
            <li key={w.id}>
              <div className="ws-info">
                <strong>{w.name}</strong>
                <span className="muted small-text">{w.tabs.length} tabs · {w.tabs.slice(0, 4).map((t) => t.title).join(', ')}{w.tabs.length > 4 ? '…' : ''} · {new Date(w.at).toLocaleString()}</span>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => { onOpen(w, true); onClose() }} title="Close the open tabs and open these">Open</button>
              <button className="btn btn-sm" onClick={() => { onOpen(w, false); onClose() }} title="Open these next to the tabs open now">Add</button>
              <button className="btn btn-sm" onClick={() => { if (window.confirm(`Replace “${w.name}” with the tabs open now?`)) save(w) }}>Update</button>
              <button className="icon-btn" title="Delete" onClick={() => { if (window.confirm(`Delete workspace “${w.name}”?`)) set(list.filter((x) => x.id !== w.id)) }}>✕</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
