// Saved AI conversations, kept on this computer so they survive closing the tab or the app.

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  error?: string
  /** Set when the user ran SQL from this answer: what came back */
  ran?: { rows?: number; ms?: number; error?: string; at: number; preview?: { columns: string[]; rows: unknown[][] } }
  at?: number
}

export interface SavedChat {
  id: string
  title: string
  /** Connection the chat was about (shown in the list) */
  connection?: string
  engine?: string
  model?: string
  created: number
  updated: number
  messages: ChatMsg[]
}

const KEY = 'aiChats'
const MAX_CHATS = 200
const MAX_MSG = 60

export function listChats(): SavedChat[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedChat[]
    return Array.isArray(list) ? list.sort((a, b) => b.updated - a.updated) : []
  } catch { return [] }
}

function write(list: SavedChat[]) {
  // Newest first; drop the oldest when there are too many or storage is full
  let l = list.sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS)
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(l)); return } catch {
      if (l.length <= 1) return
      l = l.slice(0, Math.floor(l.length * 0.8))
    }
  }
}

export const getChat = (id: string) => listChats().find((c) => c.id === id)

/** Title from the first question */
export const chatTitle = (messages: ChatMsg[]) => {
  const q = messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? 'New chat'
  return q.length > 70 ? q.slice(0, 67) + '…' : q
}

export function saveChat(c: Omit<SavedChat, 'title' | 'updated'> & { title?: string }) {
  if (!c.messages.some((m) => m.role === 'user')) return
  const list = listChats().filter((x) => x.id !== c.id)
  write([{ ...c, title: c.title || chatTitle(c.messages), updated: Date.now(), messages: c.messages.slice(-MAX_MSG) }, ...list])
}

export const deleteChat = (id: string) => write(listChats().filter((c) => c.id !== id))
export const clearChats = () => write([])
