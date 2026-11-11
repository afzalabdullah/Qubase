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
  shortcuts: {}
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
  const c = theme === 'dark' ? a.dark : a.light
  root.style.setProperty('--accent', c)
  root.style.setProperty('--accent-ink', theme === 'dark' && s.accent !== 'honey' ? '#14110e' : a.ink)
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${c} 16%, transparent)`)
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
