// Schema snapshots: a saved copy of every table's structure, to compare against later.
import type { TableInfo, TableStructure } from '../shared/types'

export interface Snapshot {
  id: string
  name: string
  /** ISO time it was taken */
  at: string
  engine: string
  /** Connection it was taken from (name, for display) */
  source: string
  tables: { t: TableInfo; s: TableStructure }[]
}

const key = (connId: string) => `snapshots:${connId}`

export function listSnapshots(connId: string): Snapshot[] {
  try { return JSON.parse(localStorage.getItem(key(connId)) ?? '[]') } catch { return [] }
}
function write(connId: string, list: Snapshot[]) {
  try { localStorage.setItem(key(connId), JSON.stringify(list)) } catch { throw new Error('Not enough room to keep this snapshot here. Save it to a file instead.') }
}
export function saveSnapshot(connId: string, s: Snapshot) { const l = [s, ...listSnapshots(connId).filter((x) => x.id !== s.id)].slice(0, 30); write(connId, l); return l }
export function deleteSnapshot(connId: string, id: string) { const l = listSnapshots(connId).filter((x) => x.id !== id); write(connId, l); return l }

/** Read every table's structure (views left out), a few at a time */
export async function takeSnapshot(dbId: string, name: string, engine: string, source: string, progress?: (done: number, total: number) => void): Promise<Snapshot> {
  const all = (await window.db.listTables(dbId)).filter((t) => t.type !== 'view')
  const out: Snapshot['tables'] = new Array(all.length)
  let i = 0, done = 0
  await Promise.all(Array.from({ length: Math.min(6, all.length) }, async () => {
    while (i < all.length) {
      const k = i++
      const t = all[k]
      const s = await window.db.getStructure(dbId, t).catch(() => ({ columns: [], indexes: [], foreignKeys: [], triggers: [] }))
      out[k] = { t: { schema: t.schema, name: t.name, type: 'table' }, s: { ...s, triggers: [] } }
      progress?.(++done, all.length)
    }
  }))
  return { id: crypto.randomUUID(), name, at: new Date().toISOString(), engine, source, tables: out }
}
