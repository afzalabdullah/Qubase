// Saved queries library, kept on this computer.

export interface SavedQuery {
  id: string
  name: string
  text: string
  /** Connection kind it was saved from (shown as a hint) */
  engine?: string
  at: number
  /** Earlier texts, newest first (kept when a query is saved again under the same name) */
  versions?: { text: string; at: number }[]
}

const MAX_VERSIONS = 30

const KEY = 'savedQueries'

export function readSavedQueries(): SavedQuery[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

function write(list: SavedQuery[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage full or unavailable */ }
}

/** Save (or replace the query with the same name). */
export function saveQuery(name: string, text: string, engine?: string): SavedQuery[] {
  const all = readSavedQueries()
  const old = all.find((q) => q.name.toLowerCase() === name.toLowerCase())
  const list = all.filter((q) => q !== old)
  const versions = old ? (old.text === text ? old.versions ?? [] : [{ text: old.text, at: old.at }, ...(old.versions ?? [])].slice(0, MAX_VERSIONS)) : []
  list.unshift({ id: old?.id ?? crypto.randomUUID(), name, text, engine, at: Date.now(), versions })
  write(list)
  return list
}

export function deleteSavedQuery(id: string): SavedQuery[] {
  const list = readSavedQueries().filter((q) => q.id !== id)
  write(list)
  return list
}
