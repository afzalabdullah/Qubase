// App settings, kept per computer in local storage.
import { createContext, useContext, useEffect, useState } from 'react'
import { DEFAULT_SHORTCUTS, ShortcutAction } from './shortcuts'
import type { SavedConnection } from '../shared/types'

export interface Settings {
  /** Editor and grid font size in px */
  fontSize: number
  /** Default row limit for new query tabs (0 = all) */
  rowLimit: number
  /** Rows loaded per page in table Data tabs */
  pageSize: number
  /** Ask before UPDATE / DELETE without WHERE */
  blockNoWhere: boolean
  /** Ask before changes on Production connections */
  confirmProduction: boolean
  /** Reopen query tabs (and their text) after a restart */
  restoreTabs: boolean
  /** Run on F5 / Ctrl+Enter: selection if any, else the statement under the cursor or everything */
  runCurrentStatement: boolean
  /** AI assistant model */
  aiModel: string
  /** App colours: light, dark or follow Windows */
  theme: 'light' | 'dark' | 'system'
  /** Accent colour name (see ACCENTS) */
  accent: string
  /** Editor colour theme (see editorThemes.ts) */
  editorTheme: string
  /** SQL formatter: keyword case and indent */
  keywordCase: 'upper' | 'lower' | 'preserve'
  indentWidth: 2 | 4
  /** Offer snippets (sel, ins, upd…) in autocomplete */
  snippets: boolean
  /** Ask for :name parameters when running */
  queryParams: boolean
  /** Shared folder for team queries and connections ('' = off) */
  teamFolder: string
  /** Update server for auto-update ('' = off) */
  updateUrl: string
  /** Own accent colour (#rrggbb) used when accent is 'custom' */
  accentCustom: string
  /** Activity bar (far-left strip) colour; '' = theme default */
  railColor: string
  /** Sidebar / table list colour; '' = theme default */
  sidebarColor: string
  /** Status bar colour: '' = charcoal, 'accent' = accent colour, or #rrggbb */
  statusColor: string
  /** Interface font (see UI_FONTS) */
  uiFont: string
  /** Editor and grid font (see MONO_FONTS) */
  monoFont: string
  /** Interface text size in px */
  uiSize: number
  /** Corner roundness */
  radius: 'sharp' | 'normal' | 'round'
  /** Spacing of lists, tabs and grid rows */
  density: 'compact' | 'normal' | 'comfortable'
  /** Changed keyboard shortcuts (missing ones use the default) */
  shortcuts: Partial<Record<ShortcutAction, string>>
}

/** Accent colours: [light, dark] */
export const ACCENTS: Record<string, { label: string; light: string; dark: string; ink: string }> = {
  orange: { label: 'Qubase orange', light: '#f2620f', dark: '#ff8a3d', ink: '#ffffff' },
  honey: { label: 'Honey', light: '#f5b80b', dark: '#fbc531', ink: '#1d1a10' },
  blue: { label: 'Blue', light: '#2563eb', dark: '#60a5fa', ink: '#ffffff' },
  green: { label: 'Green', light: '#16a34a', dark: '#4ade80', ink: '#ffffff' },
  purple: { label: 'Purple', light: '#7c3aed', dark: '#a78bfa', ink: '#ffffff' },
  rose: { label: 'Rose', light: '#e11d48', dark: '#fb7185', ink: '#ffffff' },
  teal: { label: 'Teal', light: '#0d9488', dark: '#2dd4bf', ink: '#ffffff' }
}

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 13,
  rowLimit: 10000,
  pageSize: 500,
  blockNoWhere: true,
  confirmProduction: true,
  restoreTabs: true,
  runCurrentStatement: false,
  aiModel: 'claude-opus-5-5',
  theme: 'system',
  accent: 'orange',
  editorTheme: 'auto',
  keywordCase: 'upper',
  indentWidth: 2,
  snippets: true,
  queryParams: true,
  teamFolder: '',
  updateUrl: '',
  accentCustom: '#f2620f',
  railColor: '',
  sidebarColor: '',
  statusColor: '',
  uiFont: 'segoe',
  monoFont: 'cascadia',
  uiSize: 13,
  radius: 'normal',
  density: 'normal',
  shortcuts: {}
}

/** Interface fonts: [label, CSS stack]. Fonts not installed fall back to the next in the stack. */
export const UI_FONTS: Record<string, [string, string]> = {
  segoe: ['Segoe UI (Windows)', "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"],
  inter: ['Inter', "Inter, 'Segoe UI', system-ui, sans-serif"],
  roboto: ['Roboto', "Roboto, 'Segoe UI', system-ui, sans-serif"],
  opensans: ['Open Sans', "'Open Sans', 'Segoe UI', system-ui, sans-serif"],
  arial: ['Arial', "Arial, Helvetica, sans-serif"],
  verdana: ['Verdana (wide, easy to read)', "Verdana, Geneva, sans-serif"],
  tahoma: ['Tahoma (compact)', "Tahoma, 'Segoe UI', sans-serif"],
  georgia: ['Georgia (serif)', "Georgia, 'Times New Roman', serif"],
  mono: ['Monospace everywhere', "'Cascadia Code', Consolas, monospace"]
}
export const MONO_FONTS: Record<string, [string, string]> = {
  cascadia: ['Cascadia Code', "'Cascadia Code', 'Cascadia Mono', Consolas, monospace"],
  consolas: ['Consolas', "Consolas, 'Courier New', monospace"],
  jetbrains: ['JetBrains Mono', "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"],
  fira: ['Fira Code', "'Fira Code', 'Cascadia Code', Consolas, monospace"],
  sourcecode: ['Source Code Pro', "'Source Code Pro', Consolas, monospace"],
  courier: ['Courier New', "'Courier New', Courier, monospace"],
  lucida: ['Lucida Console', "'Lucida Console', Consolas, monospace"]
}

/** Ready-made looks; picking one fills in the colour settings */
export const THEME_PRESETS: { id: string; label: string; s: Partial<Settings> }[] = [
  { id: 'qubase', label: 'Qubase', s: { accent: 'orange', railColor: '', sidebarColor: '', statusColor: '' } },
  { id: 'ocean', label: 'Ocean', s: { accent: 'custom', accentCustom: '#0e7cc9', railColor: '#0b2440', sidebarColor: '', statusColor: '#0b2440' } },
  { id: 'forest', label: 'Forest', s: { accent: 'custom', accentCustom: '#2f9e44', railColor: '#14281c', sidebarColor: '', statusColor: '#14281c' } },
  { id: 'grape', label: 'Grape', s: { accent: 'custom', accentCustom: '#7c3aed', railColor: '#24163f', sidebarColor: '', statusColor: 'accent' } },
  { id: 'rose', label: 'Rose', s: { accent: 'custom', accentCustom: '#e11d63', railColor: '#3a1424', sidebarColor: '', statusColor: '#3a1424' } },
  { id: 'midnight', label: 'Midnight', s: { theme: 'dark', accent: 'custom', accentCustom: '#38bdf8', railColor: '#0a0f1a', sidebarColor: '#0f1626', statusColor: '#0a0f1a' } },
  { id: 'paper', label: 'Paper', s: { theme: 'light', accent: 'custom', accentCustom: '#3b5bdb', railColor: '#eef0f3', sidebarColor: '#fafafa', statusColor: '#eef0f3' } },
  { id: 'mono', label: 'Graphite', s: { accent: 'custom', accentCustom: '#4b5563', railColor: '#1f2328', sidebarColor: '', statusColor: '#1f2328' } }
]

/** Perceived brightness 0–255 of #rrggbb */
export function brightness(hex: string) {
  const h = hex.replace('#', '')
  if (h.length < 6) return 128
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return (r * 299 + g * 587 + b * 114) / 1000
}
/** Accent colour in use for a theme */
export function accentOf(s: Settings, theme: 'light' | 'dark') {
  if (s.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(s.accentCustom)) {
    // In dark mode lift very dark custom accents so they stay visible
    return theme === 'dark' && brightness(s.accentCustom) < 90 ? `color-mix(in srgb, ${s.accentCustom} 65%, white)` : s.accentCustom
  }
  const a = ACCENTS[s.accent] ?? ACCENTS.orange
  return theme === 'dark' ? a.dark : a.light
}

/** The shortcut for an action, after the user's changes */
export function shortcutFor(s: Settings, a: ShortcutAction): string {
  return s.shortcuts[a] ?? DEFAULT_SHORTCUTS[a]
}

/** Light or dark, after resolving "system" */
export function resolvedTheme(s: Settings): 'light' | 'dark' {
  if (s.theme !== 'system') return s.theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const KEY = 'settings'
const EVENT = 'datahive:settings'

export function readSettings(): Settings {
  let saved: Partial<Settings> = {}
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { /* use defaults */ }
  // Older versions kept the theme on its own
  if (!saved.theme) {
    try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') saved.theme = t } catch { /* ignore */ }
  }
  // The Qubase rebrand moved the default accent from honey to orange (once)
  try {
    if (!localStorage.getItem('brandQubase')) {
      localStorage.setItem('brandQubase', '1')
      if (saved.accent === 'honey') { saved.accent = 'orange'; localStorage.setItem(KEY, JSON.stringify(saved)) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS, ...saved }
}

/** Apply font size, theme and accent to the page */
export function applySettings(s: Settings) {
  const root = document.documentElement
  const theme = resolvedTheme(s)
  root.dataset.theme = theme
  root.style.setProperty('--editor-font', `${s.fontSize}px`)
  const a = ACCENTS[s.accent] ?? ACCENTS.orange
  const c = accentOf(s, theme)
  root.style.setProperty('--accent', c)
  const ink = s.accent === 'custom' ? (brightness(s.accentCustom) > 170 ? '#1a1a1a' : '#ffffff') : theme === 'dark' && s.accent !== 'honey' ? '#14110e' : a.ink
  root.style.setProperty('--accent-ink', ink)
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${c} 16%, transparent)`)
  const hex = (v: string) => /^#[0-9a-f]{6}$/i.test(v)
  const setOrClear = (name: string, v: string | false) => { if (v) root.style.setProperty(name, v); else root.style.removeProperty(name) }
  // Activity bar: own colour, with light or dark icons to match
  setOrClear('--rail-bg', hex(s.railColor) && s.railColor)
  const railLight = hex(s.railColor) && brightness(s.railColor) > 150
  setOrClear('--rail-ink', railLight && '#4b5160'); setOrClear('--rail-ink-on', railLight && '#111317')
  setOrClear('--rail-hover', railLight && 'rgba(0, 0, 0, 0.07)')
  // Sidebar: own colour; its text switches to light or dark by brightness
  setOrClear('--sidebar', hex(s.sidebarColor) && s.sidebarColor)
  if (hex(s.sidebarColor)) root.dataset.sidebar = brightness(s.sidebarColor) > 150 ? 'light' : 'dark'
  else delete root.dataset.sidebar
  // Status bar
  const sb = s.statusColor === 'accent' ? c : hex(s.statusColor) ? s.statusColor : ''
  setOrClear('--status-bg', sb)
  setOrClear('--status-ink', sb && (s.statusColor === 'accent' ? ink : brightness(s.statusColor) > 150 ? '#1a1a1a' : '#f1f2f4'))
  // Fonts, size, corners, spacing
  root.style.setProperty('--ui-font', (UI_FONTS[s.uiFont] ?? UI_FONTS.segoe)[1])
  root.style.setProperty('--mono', (MONO_FONTS[s.monoFont] ?? MONO_FONTS.cascadia)[1])
  root.style.setProperty('--ui-size', `${s.uiSize || 13}px`)
  root.style.setProperty('--radius', s.radius === 'sharp' ? '3px' : s.radius === 'round' ? '12px' : '8px')
  root.dataset.radius = s.radius
  root.dataset.density = s.density
}

export function writeSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage unavailable */ }
  applySettings(s)
  window.dispatchEvent(new Event(EVENT))
}

/** Current settings; re-renders when they are saved, or when Windows switches light / dark */
export function useSettings(): Settings {
  const [s, setS] = useState(readSettings)
  useEffect(() => {
    const update = () => { const n = readSettings(); applySettings(n); setS(n) }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    window.addEventListener(EVENT, update)
    mq.addEventListener('change', update)
    return () => { window.removeEventListener(EVENT, update); mq.removeEventListener('change', update) }
  }, [])
  return s
}

/** The open connection, for components deep in the tree (safety checks, engine name). */
export interface ConnInfo { conn: SavedConnection; engine: string; connId: string }
export const ConnContext = createContext<ConnInfo | null>(null)
export const useConn = () => useContext(ConnContext)!
