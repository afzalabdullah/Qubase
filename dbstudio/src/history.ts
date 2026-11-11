// Query history, kept in this browser profile (per app install).

export interface HistoryItem {
  text: string
  at: number
  ok: boolean
  ms: number
}

const KEY = 'queryHistory'
const MAX = 100

export function readHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function addHistory(item: HistoryItem) {
  try {
    // Newest first; drop an exact repeat of the same text
    const list = [item, ...readHistory().filter((h) => h.text !== item.text)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch { /* storage unavailable */ }
}
