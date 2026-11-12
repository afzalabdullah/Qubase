// Keyboard shortcuts. Every one can be changed or turned off in Settings → Keyboard shortcuts.
// Keys are written like "Ctrl+Shift+P"; "Ctrl" also matches Cmd on a Mac. An empty string means "off".

export type ShortcutAction =
  // Editor (work while typing in a query or notebook cell)
  | 'run' | 'plan' | 'format' | 'saveQuery' | 'saveFile' | 'saveFileAs' | 'openFile'
  // Tabs
  | 'newQuery' | 'closeTab' | 'reopenTab' | 'nextTab' | 'prevTab' | 'pinTab' | 'splitRight'
  // Open
  | 'palette' | 'settings' | 'shortcutsHelp' | 'newNotebook' | 'findInDb' | 'queryBuilder' | 'dataCompare' | 'schemaCompare' | 'erDiagram' | 'schedules'
  // View
  | 'toggleSidebar' | 'focusTables' | 'refreshSchema' | 'toggleTheme'

export interface ShortcutInfo { label: string; group: 'Editor' | 'Tabs' | 'Open' | 'View'; key: string }

export const SHORTCUTS: Record<ShortcutAction, ShortcutInfo> = {
  run: { label: 'Run query (selection, or all)', group: 'Editor', key: 'Ctrl+Enter' },
  plan: { label: 'Show query plan', group: 'Editor', key: 'Ctrl+L' },
  format: { label: 'Format SQL', group: 'Editor', key: 'Shift+Alt+F' },
  saveFile: { label: 'Save query to a file', group: 'Editor', key: 'Ctrl+S' },
  saveFileAs: { label: 'Save query to a new file (Save as)', group: 'Editor', key: 'Ctrl+Shift+S' },
  saveQuery: { label: 'Save query to the library', group: 'Editor', key: 'Ctrl+Alt+S' },

  newQuery: { label: 'New query tab', group: 'Tabs', key: 'Ctrl+T' },
  closeTab: { label: 'Close tab', group: 'Tabs', key: 'Ctrl+W' },
  reopenTab: { label: 'Reopen closed query tab', group: 'Tabs', key: 'Ctrl+Shift+T' },
  nextTab: { label: 'Next tab', group: 'Tabs', key: 'Ctrl+Tab' },
  prevTab: { label: 'Previous tab', group: 'Tabs', key: 'Ctrl+Shift+Tab' },
  pinTab: { label: 'Pin / unpin tab', group: 'Tabs', key: 'Ctrl+Alt+P' },
  splitRight: { label: 'Open next tab to the side / close split', group: 'Tabs', key: 'Ctrl+\\' },

  palette: { label: 'Command palette', group: 'Open', key: 'Ctrl+K' },
  settings: { label: 'Settings', group: 'Open', key: 'Ctrl+,' },
  shortcutsHelp: { label: 'Keyboard shortcuts list', group: 'Open', key: 'F1' },
  openFile: { label: 'Open a .sql file', group: 'Open', key: 'Ctrl+O' },
  newNotebook: { label: 'New notebook', group: 'Open', key: 'Ctrl+Shift+N' },
  findInDb: { label: 'Find in database', group: 'Open', key: 'Ctrl+Shift+F' },
  queryBuilder: { label: 'Visual query builder', group: 'Open', key: 'Ctrl+Shift+B' },
  dataCompare: { label: 'Data compare', group: 'Open', key: 'Ctrl+Shift+D' },
  schemaCompare: { label: 'Schema compare', group: 'Open', key: '' },
  erDiagram: { label: 'ER diagram', group: 'Open', key: 'Ctrl+Shift+E' },
  schedules: { label: 'Scheduled queries', group: 'Open', key: '' },

  toggleSidebar: { label: 'Show / hide sidebar', group: 'View', key: 'Ctrl+B' },
  focusTables: { label: 'Filter tables in the sidebar', group: 'View', key: 'Ctrl+P' },
  refreshSchema: { label: 'Refresh tables', group: 'View', key: 'Ctrl+Shift+R' },
  toggleTheme: { label: 'Switch light / dark', group: 'View', key: 'Ctrl+Alt+T' }
}

export const ACTIONS = Object.keys(SHORTCUTS) as ShortcutAction[]
export const SHORTCUT_GROUPS = ['Editor', 'Tabs', 'Open', 'View'] as const
export const SHORTCUT_LABELS = Object.fromEntries(ACTIONS.map((a) => [a, SHORTCUTS[a].label])) as Record<ShortcutAction, string>
export const DEFAULT_SHORTCUTS = Object.fromEntries(ACTIONS.map((a) => [a, SHORTCUTS[a].key])) as Record<ShortcutAction, string>

/** Run inside the editor; the others are app-wide */
export const EDITOR_ACTIONS: ShortcutAction[] = ['run', 'plan', 'format', 'saveQuery', 'saveFile', 'saveFileAs']

/** Keys the app can't take over (the system or the editor needs them) */
export const RESERVED = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+F', 'Ctrl+/', 'Escape', 'Enter', 'Tab', 'Backspace', 'Delete'])

const keyName = (k: string) => {
  if (k === ' ') return 'Space'
  if (k.length === 1) return k.toUpperCase()
  return k === 'Esc' ? 'Escape' : k
}

/** "Ctrl+Shift+P" for a key press, or '' while only modifiers are held */
export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return ''
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  // Use the physical key so Shift / Alt / the keyboard layout don't change it
  const code = (e as KeyboardEvent).code ?? ''
  const punct: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`' }
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : punct[code] ?? keyName(e.key)
  parts.push(key)
  return parts.join('+')
}

/** Normalise "shift+ctrl+p" → "Ctrl+Shift+P" so comparisons work */
export function normalise(combo: string): string {
  if (!combo) return ''
  const bits = combo.split(/\+(?!$)/).map((b) => b.trim()).filter(Boolean)
  const mods = ['Ctrl', 'Alt', 'Shift'].filter((m) => bits.some((b) => b.toLowerCase() === m.toLowerCase() || (m === 'Ctrl' && /^(cmd|mod|meta)$/i.test(b))))
  const key = bits.find((b) => !/^(ctrl|alt|shift|cmd|mod|meta)$/i.test(b)) ?? ''
  return [...mods, keyName(key.length === 1 ? key.toUpperCase() : key)].join('+')
}

export function matches(e: KeyboardEvent, combo: string): boolean {
  return !!combo && comboFromEvent(e) === normalise(combo)
}

/** CodeMirror key name, e.g. "Ctrl+Enter" → "Mod-Enter" */
export function toCodeMirror(combo: string): string {
  return normalise(combo).split('+').map((b) => (b === 'Ctrl' ? 'Mod' : b.length === 1 ? b.toLowerCase() : b)).join('-')
}

/** Pairs of actions that share the same keys */
export function conflicts(get: (a: ShortcutAction) => string): Map<ShortcutAction, ShortcutAction[]> {
  const byKey = new Map<string, ShortcutAction[]>()
  for (const a of ACTIONS) {
    const k = normalise(get(a))
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), a])
  }
  const out = new Map<ShortcutAction, ShortcutAction[]>()
  for (const list of byKey.values()) if (list.length > 1) for (const a of list) out.set(a, list.filter((x) => x !== a))
  return out
}

/** "Ctrl+Shift+P" → ["Ctrl", "Shift", "P"] for drawing key caps */
export const keyCaps = (combo: string) => (combo ? normalise(combo).split(/\+(?!$)/) : [])
