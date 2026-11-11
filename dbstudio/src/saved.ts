// Saved queries library, kept on this computer.

export interface SavedQuery {
  id: string
  name: string
  text: string
  /** Connection kind it was saved from (shown as a hint) */
  engine?: string
  at: number
}

const KEY = 'savedQueries'

export function readSavedQueries(): SavedQuery[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

function write(list: SavedQuery[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage full or unavailable */ }
}

/** Save (or replace the query with the same name). */
export function saveQuery(name: string, text: string, engine?: string): SavedQuery[] {
  const list = readSavedQueries().filter((q) => q.name.toLowerCase() !== name.toLowerCase())
  list.unshift({ id: crypto.randomUUID(), name, text, engine, at: Date.now() })
  write(list)
  return list
}

export function deleteSavedQuery(id: string): SavedQuery[] {
  const list = readSavedQueries().filter((q) => q.id !== id)
  write(list)
  return list
}
