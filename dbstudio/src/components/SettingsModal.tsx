import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ACCENTS, accentOf, applySettings, DEFAULT_SETTINGS, MONO_FONTS, readSettings, resolvedTheme, Settings, shortcutFor, THEME_PRESETS, UI_FONTS, writeSettings } from '../settings'
import { IconPlus, IconSearch, IconTrash, IconX } from './Icons'
import { EDITOR_THEMES } from '../editorThemes'
import { BUILT_IN_SNIPPETS, readHiddenSnippets, readUserSnippets, Snippet, writeHiddenSnippets, writeUserSnippets } from '../snippets'
import { ACTIONS, comboFromEvent, conflicts, keyCaps, normalise, RESERVED, SHORTCUT_GROUPS, SHORTCUTS, ShortcutAction } from '../shortcuts'
import { errMsg } from '../util'
import { readSavedQueries, saveQuery } from '../saved'
import { toast } from 'sonner'
import { AI_PROVIDERS, aiProvider, type AiConfigView, type AiProvider } from '../../shared/aiProviders'
import type { LicenceInfo } from '../../shared/types'


export const SETTINGS_SECTIONS = [
  ['appearance', 'Appearance'],
  ['editor', 'Editor'],
  ['formatting', 'Formatting & snippets'],
  ['shortcuts', 'Keyboard shortcuts'],
  ['results', 'Results & data'],
  ['safety', 'Safety'],
  ['ai', 'AI assistant'],
  ['team', 'Team folder'],
  ['about', 'Troubleshooting']
] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number][0]

/** Which settings each section owns, for its Reset button */
const SECTION_KEYS: Partial<Record<SettingsSection, (keyof Settings)[]>> = {
  appearance: ['theme', 'accent', 'accentCustom', 'railColor', 'sidebarColor', 'statusColor', 'uiFont', 'uiSize', 'monoFont', 'fontSize', 'editorTheme', 'radius', 'density'],
  editor: ['runCurrentStatement', 'queryParams', 'restoreTabs'],
  formatting: ['keywordCase', 'indentWidth', 'snippets'],
  shortcuts: ['shortcuts'],
  results: ['rowLimit', 'pageSize'],
  safety: ['blockNoWhere', 'confirmProduction'],
  ai: ['aiModel'],
  team: ['teamFolder'],
}
/** Settings that are not personal preferences; "Reset all" leaves them alone */
const KEEP_ON_RESET_ALL: (keyof Settings)[] = ['teamFolder', 'updateUrl']

/** Key caps, e.g. [Ctrl] [Shift] [P] */
export function Keys({ combo, empty = 'Off' }: { combo: string; empty?: string }) {
  const caps = keyCaps(combo)
  if (!caps.length) return <span className="muted small-text">{empty}</span>
  return <span className="keys">{caps.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
}

/** One setting: label and help on the left, the control on the right */
function Row({ label, help, children, wide }: { label: ReactNode; help?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`setting-row ${wide ? 'wide' : ''}`}>
      <div className="setting-text"><div className="setting-label">{label}</div>{help && <div className="setting-help">{help}</div>}</div>
      <div className="setting-control">{children}</div>
    </div>
  )
}
/** Colour picker plus a hex box */
function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <span className="color-pick">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label="Pick a colour" />
      <input type="text" value={text} maxLength={7} onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()) }} aria-label="Colour code" />
    </span>
  )
}

/** Theme default, or the user's own colour */
function OptionalColor({ value, onChange, fallback }: { value: string; onChange: (v: string) => void; fallback: string }) {
  return (
    <span className="color-pick">
      <span className="seg-ctl">
        <button type="button" className={!value ? 'on' : ''} onClick={() => onChange('')}>Theme default</button>
        <button type="button" className={value ? 'on' : ''} onClick={() => onChange(value || fallback)}>Own colour</button>
      </span>
      {value && <ColorInput value={value} onChange={onChange} />}
    </span>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="toggle" title={label}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} /><span /></label>
}

/** Full-screen settings with a section list, search and an unsaved-changes bar. */
export function SettingsModal({ onClose, onSaved, section }: { onClose: () => void; onSaved: (s: Settings) => void; section?: SettingsSection }) {
  const [saved0] = useState<Settings>(readSettings)
  const [s, setS] = useState<Settings>(saved0)
  const [key, setKey] = useState('')
  /** AI provider settings live in the main process (keys encrypted there) */
  const [aiCfg, setAiCfg] = useState<AiConfigView | null>(null)
  const [ai, setAi] = useState<{ provider: AiProvider; model: string; baseUrl: string } | null>(null)
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiModels, setAiModels] = useState<string[]>([])
  const aiFrom = (cfg: AiConfigView, provider: AiProvider) => ({ provider, model: cfg.providers[provider]?.model ?? aiProvider(provider).defaultModel, baseUrl: cfg.providers[provider]?.baseUrl ?? aiProvider(provider).baseUrl ?? '' })
  const aiDirty = !!(aiCfg && ai && JSON.stringify(ai) !== JSON.stringify(aiFrom(aiCfg, aiCfg.provider)))
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [userSnips, setUserSnips] = useState<Snippet[]>(readUserSnippets)
  const [hidden, setHidden] = useState<string[]>(readHiddenSnippets)
  const [snipsDirty, setSnipsDirty] = useState(false)
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [query, setQuery] = useState('')
  const [scQuery, setScQuery] = useState('')
  const [current, setCurrent] = useState<SettingsSection>(section ?? 'appearance')
  const body = useRef<HTMLDivElement>(null)
  const set = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }))

  const [version, setVersion] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')
  const [licence, setLicence] = useState<LicenceInfo | null>(null)
  const [licenceKey, setLicenceKey] = useState('')
  const [teamMsg, setTeamMsg] = useState('')
  useEffect(() => {
    window.db.aiGetConfig().then((c) => { setAiCfg(c); setAi(aiFrom(c, c.provider)) }).catch(() => {})
    window.db.appVersion().then(setVersion).catch(() => {})
    window.db.getLicence().then(setLicence).catch(() => {})
  }, [])

  const dirty = JSON.stringify(s) !== JSON.stringify(saved0) || snipsDirty || !!key || aiDirty
  useEffect(() => { applySettings(s) }, [s])
  useEffect(() => () => applySettings(readSettings()), [])
  const clash = useMemo(() => conflicts((a) => shortcutFor(s, a)), [s])

  const save = async () => {
    try {
      if (clash.size) { const [a, others] = [...clash.entries()][0]; setError(`${normalise(shortcutFor(s, a))} is used for both “${SHORTCUTS[a].label}” and “${SHORTCUTS[others[0]].label}”. Change one of them first.`); jump('shortcuts'); return }
      writeSettings(s)
      writeUserSnippets(userSnips)
      writeHiddenSnippets(hidden)
      if (ai && (key || aiDirty)) await window.db.aiSetConfig({ provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl, key: key.trim() })
      onSaved(s)
      onClose()
    } catch (e) { setError(errMsg(e)) }
  }
  const close = () => { if (!dirty || window.confirm('Close without saving your changes?')) onClose() }

  // Esc closes, Ctrl+S saves
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (recording) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save() }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  const jump = (id: SettingsSection) => { setCurrent(id); body.current?.querySelector(`#set-${id}`)?.scrollIntoView({ block: 'start' }) }
  useEffect(() => { if (section) setTimeout(() => jump(section), 0) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Highlight the section being read
  const onScroll = () => {
    const top = body.current!.getBoundingClientRect().top + 40
    let cur: SettingsSection = 'appearance'
    for (const [id] of SETTINGS_SECTIONS) { const el = body.current!.querySelector(`#set-${id}`); if (el && el.getBoundingClientRect().top <= top) cur = id }
    setCurrent(cur)
  }
  // Search: hide rows (and whole sections) that don't match
  useEffect(() => {
    const q = query.trim().toLowerCase()
    body.current?.querySelectorAll<HTMLElement>('.settings-section').forEach((sec) => {
      let any = false
      sec.querySelectorAll<HTMLElement>('.setting-row, .shortcut-row, .snippet-row').forEach((r) => {
        const hit = !q || r.textContent!.toLowerCase().includes(q) || sec.dataset.title!.toLowerCase().includes(q)
        r.style.display = hit ? '' : 'none'
        any ||= hit
      })
      sec.style.display = !q || any || sec.dataset.title!.toLowerCase().includes(q) ? '' : 'none'
    })
  }, [query, s, userSnips])

  const checkUpdate = async () => {
    setUpdateMsg('Checking…')
    try {
      const u = await window.db.checkForUpdate(s.updateUrl)
      setUpdateMsg(u.available ? `Version ${u.latest} is available.` : `You have the latest version (${u.current}).`)
      if (u.available && window.confirm(`Qubase ${u.latest} is available (you have ${u.current}). Open the download?`)) window.open(u.download)
    } catch (e) { setUpdateMsg(errMsg(e)) }
  }
  const activate = async () => { const r = await window.db.setLicence(licenceKey); setLicence(r); if (r.valid) setLicenceKey('') }
  const shareQueries = async () => {
    try {
      const qs = readSavedQueries().map((q) => ({ name: q.name, text: q.text, engine: q.engine, at: q.at }))
      const t = await window.db.shareToTeam(s.teamFolder, { queries: qs })
      setTeamMsg(`Shared ${qs.length} queries. The team folder now has ${t.queries.length}.`)
    } catch (e) { setTeamMsg(errMsg(e)) }
  }
  const shareConns = async () => {
    try {
      const cs = await window.db.listSaved()
      const t = await window.db.shareToTeam(s.teamFolder, { connections: cs })
      setTeamMsg(`Shared ${cs.length} connections without passwords. The team folder now has ${t.connections.length}.`)
    } catch (e) { setTeamMsg(errMsg(e)) }
  }

  const setShortcut = (a: ShortcutAction, combo: string | undefined) => {
    const n = { ...s.shortcuts }
    if (combo === undefined || normalise(combo) === normalise(SHORTCUTS[a].key)) delete n[a]
    else n[a] = combo
    set({ shortcuts: n })
  }
  const record = (a: ShortcutAction, e: React.KeyboardEvent) => {
    if (recording !== a) return
    e.preventDefault(); e.stopPropagation()
    if (e.key === 'Escape') { setRecording(null); return }
    if (e.key === 'Backspace' || e.key === 'Delete') { setShortcut(a, ''); setRecording(null); return }
    const combo = comboFromEvent(e)
    if (!combo) return
    if (RESERVED.has(combo)) { setError(`${combo} is used by Windows or the editor (copy, paste, undo, find…). Pick other keys.`); return }
    if (!/^F\d+$/.test(combo.split('+').pop()!) && !/^(Ctrl|Alt)\+/.test(combo)) { setError('Use Ctrl or Alt with a key (or a function key like F2), so typing isn\'t caught.'); return }
    setError('')
    setShortcut(a, combo)
    setRecording(null)
  }
  const scq = scQuery.trim().toLowerCase()

  const isDefault = (k: keyof Settings) => JSON.stringify(s[k]) === JSON.stringify(DEFAULT_SETTINGS[k])
  const resetKeys = (keys: (keyof Settings)[]) => set(Object.fromEntries(keys.map((k) => [k, DEFAULT_SETTINGS[k]])) as Partial<Settings>)
  const changedCount = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => !KEEP_ON_RESET_ALL.includes(k) && !isDefault(k)).length
  /** Everything personal in one file: settings, shortcuts, snippets and the saved-query library (no passwords or keys) */
  const exportAll = async () => {
    const data = { app: 'qubase', kind: 'settings', version: 1, exported: new Date().toISOString(), settings: s, snippets: userSnips, hiddenSnippets: hidden, savedQueries: readSavedQueries() }
    const p = await window.db.saveTextFile(JSON.stringify(data, null, 2), { name: 'qubase-settings', filter: 'Qubase settings', ext: 'json' })
    if (p) { setInfo(`Exported to ${p}`); toast.success('Settings exported', { description: p }) }
  }
  const importAll = async () => {
    setError(''); setInfo('')
    try {
      const f = await window.db.openTextFile({ filter: 'Qubase settings', ext: 'json' })
      if (!f) return
      const d = JSON.parse(f.content)
      if (d?.kind !== 'settings' || typeof d.settings !== 'object') throw new Error('This file is not a Qubase settings export')
      const qs: { name: string; text: string; engine?: string }[] = Array.isArray(d.savedQueries) ? d.savedQueries : []
      if (!window.confirm(`Load settings from this file?\n\nSettings, shortcuts and snippets are filled in here (press Save to keep them).${qs.length ? `\n${qs.length} saved queries are added to your library now (same names are replaced).` : ''}`)) return
      // Only known settings, so an old or edited file can't add junk
      const known = Object.fromEntries(Object.entries(d.settings).filter(([k]) => k in DEFAULT_SETTINGS)) as Partial<Settings>
      setS({ ...DEFAULT_SETTINGS, ...known })
      if (Array.isArray(d.snippets)) { setUserSnips(d.snippets); setSnipsDirty(true) }
      if (Array.isArray(d.hiddenSnippets)) { setHidden(d.hiddenSnippets); setSnipsDirty(true) }
      for (const q of [...qs].reverse()) if (q?.name && q?.text) saveQuery(q.name, q.text, q.engine)
      setInfo(`Loaded from ${f.path}. Press Save to keep the settings.`)
    } catch (e) { setError(`Import failed: ${errMsg(e)}`) }
  }
  const resetAll = () => {
    if (!window.confirm(`Put ${changedCount} changed setting${changedCount === 1 ? '' : 's'} back to the defaults?\n\nLooks, editor, formatting, shortcuts, results, safety and AI model are reset. Your team folder, update server, AI key, snippets and saved queries are kept. Nothing is stored until you press Save.`)) return
    resetKeys((Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => !KEEP_ON_RESET_ALL.includes(k)))
  }

  const Section = ({ id, children, help }: { id: SettingsSection; children: ReactNode; help?: ReactNode }) => {
    const title = SETTINGS_SECTIONS.find((x) => x[0] === id)![1]
    const keys = SECTION_KEYS[id]
    const changed = keys ? keys.filter((k) => !isDefault(k)).length : 0
    return (
      <section id={`set-${id}`} className="settings-section" data-title={title}>
        <div className="section-head">
          <h3>{title}</h3>
          {keys && (
            <button type="button" className="btn btn-sm ghost reset-btn" disabled={!changed} onClick={() => resetKeys(keys)}
              title={changed ? `Put the ${changed} changed setting${changed === 1 ? '' : 's'} in ${title} back to the defaults` : 'Already on the defaults'}>
              {changed ? `Reset to defaults (${changed})` : 'Defaults'}
            </button>
          )}
        </div>
        {help && <p className="section-help">{help}</p>}
        <div className="settings-card">{children}</div>
      </section>
    )
  }

  return (
    <div className="settings-page settings-modal" role="dialog" aria-label="Settings">
      <header className="settings-top">
        <strong className="settings-title">Settings</strong>
        <div className="settings-search">
          <IconSearch className="search-icon" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings…" />
        </div>
        {info && <span className="settings-info small-text">{info}</span>}
        <div className="spacer" />
        <button className="btn btn-sm" onClick={importAll} title="Load settings, shortcuts, snippets and saved queries from a file">Import…</button>
        <button className="btn btn-sm" onClick={exportAll} title="Save settings, shortcuts, snippets and saved queries to a file, to use on another computer">Export…</button>
        <button className="btn btn-sm" onClick={resetAll} disabled={!changedCount} title="Put every setting back to the defaults (you still need to Save)">Reset all settings{changedCount ? ` (${changedCount})` : ''}</button>
        <button className="icon-btn" onClick={close} title="Close (Esc)"><IconX /></button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav">
          {SETTINGS_SECTIONS.map(([id, label]) => (
            <button key={id} className={current === id ? 'on' : ''} onClick={() => jump(id)}>
              {label}{id === 'shortcuts' && clash.size > 0 && <span className="nav-warn" title="Two actions share the same keys">!</span>}
            </button>
          ))}
        </nav>
        <div className="settings-body modal-body" ref={body} onScroll={onScroll}>
          {Section({ id: 'appearance', help: 'Changes show straight away; Save keeps them, Discard puts the old look back.', children: <>
            <div className="preset-grid">
              {THEME_PRESETS.map((pr) => {
                const v = { ...s, ...pr.s } as Settings
                const th = v.theme === 'system' ? resolvedTheme(s) : v.theme
                const acc = accentOf(v, th)
                const rail = v.railColor || (th === 'dark' ? '#141518' : '#26292e')
                const side = v.sidebarColor || (th === 'dark' ? '#17191c' : '#f2f2f4')
                const main = th === 'dark' ? '#1d1f23' : '#ffffff'
                const status = v.statusColor === 'accent' ? acc : v.statusColor || rail
                const on = Object.entries(pr.s).every(([k, val]) => (s as unknown as Record<string, unknown>)[k] === val)
                return (
                  <button key={pr.id} type="button" className={`preset ${on ? 'on' : ''}`} onClick={() => set(pr.s)} title={`Use the ${pr.label} look`}>
                    <span className="mini">
                      <span className="mini-rail" style={{ background: rail }} />
                      <span className="mini-side" style={{ background: side, color: th === 'dark' || (v.sidebarColor && parseInt(v.sidebarColor.slice(1, 3), 16) < 120) ? '#fff' : '#000' }}><i /><i /><i /><i /></span>
                      <span className="mini-main" style={{ background: main, color: th === 'dark' ? '#fff' : '#000' }}>
                        <span className="mini-body"><span className="mini-btn" style={{ background: acc }} /><i /><i style={{ width: '70%' }} /><i style={{ width: '50%' }} /></span>
                        <span className="mini-status" style={{ background: status }} />
                      </span>
                    </span>
                    <span className="preset-name">{pr.label}</span>
                  </button>
                )
              })}
            </div>
            <Row label="Theme" help="“Same as Windows” follows your Windows light / dark setting.">
              <div className="seg-ctl">
                {([['system', 'Same as Windows'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([v, l]) => <button key={v} type="button" className={s.theme === v ? 'on' : ''} onClick={() => set({ theme: v })}>{l}</button>)}
              </div>
            </Row>
            <Row label="Accent colour" help="Buttons, highlights, the active tab and links. Pick any colour with the rainbow swatch.">
              <div className="color-row">
                {Object.entries(ACCENTS).map(([id, a]) => (
                  <button key={id} type="button" className={`swatch ${s.accent === id ? 'on' : ''}`} style={{ background: a.light }} title={a.label} onClick={() => set({ accent: id })} />
                ))}
                <button type="button" className={`swatch custom ${s.accent === 'custom' ? 'on' : ''}`} title="Your own colour" onClick={() => set({ accent: 'custom' })} />
                {s.accent === 'custom' && <ColorInput value={s.accentCustom} onChange={(v) => set({ accentCustom: v })} />}
              </div>
            </Row>
            <Row label="Activity bar colour" help="The strip of icons on the far left.">
              <OptionalColor value={s.railColor} onChange={(v) => set({ railColor: v })} fallback="#26292e" />
            </Row>
            <Row label="Sidebar colour" help="Table list and the saved-connections panel. Text turns light or dark to stay readable.">
              <OptionalColor value={s.sidebarColor} onChange={(v) => set({ sidebarColor: v })} fallback="#f2f2f4" />
            </Row>
            <Row label="Status bar colour" help="The bar along the bottom of the window.">
              <div className="color-pick">
                <div className="seg-ctl">
                  <button type="button" className={!s.statusColor ? 'on' : ''} onClick={() => set({ statusColor: '' })}>Charcoal</button>
                  <button type="button" className={s.statusColor === 'accent' ? 'on' : ''} onClick={() => set({ statusColor: 'accent' })}>Accent</button>
                  <button type="button" className={s.statusColor.startsWith('#') ? 'on' : ''} onClick={() => set({ statusColor: s.railColor || '#1f2328' })}>Own colour</button>
                </div>
                {s.statusColor.startsWith('#') && <ColorInput value={s.statusColor} onChange={(v) => set({ statusColor: v })} />}
              </div>
            </Row>
            <Row label="Interface font" help={<span className="font-sample" style={{ fontFamily: (UI_FONTS[s.uiFont] ?? UI_FONTS.segoe)[1] }}>Tables, Connections · The quick brown fox 0123</span>}>
              <select value={s.uiFont} onChange={(e) => set({ uiFont: e.target.value })}>
                {Object.entries(UI_FONTS).map(([id, [l]]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </Row>
            <Row label="Interface text size" help="Menus, lists, tabs and buttons.">
              <div className="seg-ctl">
                {[12, 13, 14, 15, 16].map((n) => <button key={n} type="button" className={s.uiSize === n ? 'on' : ''} onClick={() => set({ uiSize: n })}>{n}</button>)}
              </div>
            </Row>
            <Row label="Editor and grid font" help={<span className="font-sample" style={{ fontFamily: (MONO_FONTS[s.monoFont] ?? MONO_FONTS.cascadia)[1] }}>SELECT id, name FROM orders WHERE total &gt;= 100; -- 0O 1lI</span>}>
              <select value={s.monoFont} onChange={(e) => set({ monoFont: e.target.value })}>
                {Object.entries(MONO_FONTS).map(([id, [l]]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </Row>
            <Row label="Editor font size" help="Editor and result grid, 10–24.">
              <input type="number" min={10} max={24} value={s.fontSize} onChange={(e) => set({ fontSize: Math.min(24, Math.max(10, Number(e.target.value) || 13)) })} />
            </Row>
            <Row label="Editor colours">
              <select value={s.editorTheme} onChange={(e) => set({ editorTheme: e.target.value })}>
                {EDITOR_THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </Row>
            <Row label="Corners" help="How round buttons, fields, menus and cards are.">
              <div className="seg-ctl">
                {([['sharp', 'Sharp'], ['normal', 'Normal'], ['round', 'Round']] as const).map(([v, l]) => <button key={v} type="button" className={s.radius === v ? 'on' : ''} onClick={() => set({ radius: v })}>{l}</button>)}
              </div>
            </Row>
            <Row label="Spacing" help="Height of table-list rows, grid rows, tabs and toolbars.">
              <div className="seg-ctl">
                {([['compact', 'Compact'], ['normal', 'Normal'], ['comfortable', 'Comfortable']] as const).map(([v, l]) => <button key={v} type="button" className={s.density === v ? 'on' : ''} onClick={() => set({ density: v })}>{l}</button>)}
              </div>
            </Row>
          </> })}

          {Section({ id: 'editor', children: <>
            <Row label="Run only the statement under the cursor" help={<>When nothing is selected, {shortcutFor(s, 'run') || 'Run'} / F5 runs just the statement where the cursor is.</>}>
              <Toggle checked={s.runCurrentStatement} onChange={(v) => set({ runCurrentStatement: v })} label="Run current statement" />
            </Row>
            <Row label="Ask for query parameters" help={<>Queries with <code>:name</code> or <code>{'{{name}}'}</code> ask for values before running.</>}>
              <Toggle checked={s.queryParams} onChange={(v) => set({ queryParams: v })} label="Query parameters" />
            </Row>
            <Row label="Reopen tabs after a restart" help="Query tabs and their text come back for each connection.">
              <Toggle checked={s.restoreTabs} onChange={(v) => set({ restoreTabs: v })} label="Restore tabs" />
            </Row>
          </> })}

          {Section({ id: 'formatting', children: <>
            <Row label="Keyword case when formatting">
              <select value={s.keywordCase} onChange={(e) => set({ keywordCase: e.target.value as Settings['keywordCase'] })}>
                <option value="upper">UPPER (SELECT)</option><option value="lower">lower (select)</option><option value="preserve">Keep as typed</option>
              </select>
            </Row>
            <Row label="Indent">
              <select value={s.indentWidth} onChange={(e) => set({ indentWidth: Number(e.target.value) as 2 | 4 })}>
                <option value={2}>2 spaces</option><option value={4}>4 spaces</option>
              </select>
            </Row>
            <Row label="Snippets while typing" help={<>Type <code>sel</code> and press Enter; Tab jumps between the blanks.</>}>
              <Toggle checked={s.snippets} onChange={(v) => set({ snippets: v })} label="Snippets" />
            </Row>
            {s.snippets && (
              <div className="snippet-list">
                {userSnips.map((sn) => (
                  <div key={sn.id} className="snippet-row">
                    <code>{sn.trigger}</code><span className="grow">{sn.description}</span>
                    <button className="btn btn-sm" onClick={() => setEditing(sn)}>Edit</button>
                    <button className="icon-btn" title="Delete" onClick={() => { setUserSnips((l) => l.filter((x) => x.id !== sn.id)); setSnipsDirty(true) }}><IconTrash width={13} height={13} /></button>
                  </div>
                ))}
                {BUILT_IN_SNIPPETS.map((sn) => (
                  <label key={sn.id} className="snippet-row">
                    <input type="checkbox" checked={!hidden.includes(sn.id)} onChange={(e) => { setHidden((h) => (e.target.checked ? h.filter((x) => x !== sn.id) : [...h, sn.id])); setSnipsDirty(true) }} />
                    <code>{sn.trigger}</code><span className="grow">{sn.description}</span><span className="muted small-text">built-in</span>
                  </label>
                ))}
                {editing ? (
                  <div className="snippet-edit">
                    <div className="row">
                      <input value={editing.trigger} onChange={(e) => setEditing({ ...editing, trigger: e.target.value.replace(/\W/g, '') })} placeholder="Trigger (e.g. top10)" />
                      <input className="grow" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Description" />
                    </div>
                    <textarea rows={4} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} placeholder={'SELECT TOP 10 * FROM ${table};'} spellCheck={false} />
                    <div className="row">
                      <span className="muted small-text grow">Write {'${name}'} for each blank to fill in.</span>
                      <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" disabled={!editing.trigger || !editing.body.trim()} onClick={() => {
                        setUserSnips((l) => (l.some((x) => x.id === editing.id) ? l.map((x) => (x.id === editing.id ? editing : x)) : [...l, editing]))
                        setSnipsDirty(true); setEditing(null)
                      }}>Keep</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-sm" onClick={() => setEditing({ id: crypto.randomUUID(), trigger: '', description: '', body: '' })}><IconPlus width={13} height={13} /> New snippet</button>
                )}
              </div>
            )}
          </> })}

          {Section({ id: 'shortcuts', help: <>Click a shortcut, then press the new keys. <kbd>Backspace</kbd> turns it off, <kbd>Esc</kbd> cancels. F5 also runs the query. Press <Keys combo={shortcutFor(s, 'shortcutsHelp')} empty="(off)" /> anywhere to see this list.</>, children: <>
            <div className="shortcut-tools">
              <div className="settings-search small"><IconSearch className="search-icon" /><input value={scQuery} onChange={(e) => setScQuery(e.target.value)} placeholder="Search actions or keys…" /></div>
              <span className="spacer" />
              <button className="btn btn-sm" disabled={!Object.keys(s.shortcuts).length} onClick={() => set({ shortcuts: {} })}>Reset all to defaults</button>
            </div>
            {SHORTCUT_GROUPS.map((g) => {
              const list = ACTIONS.filter((a) => SHORTCUTS[a].group === g && (!scq || SHORTCUTS[a].label.toLowerCase().includes(scq) || normalise(shortcutFor(s, a)).toLowerCase().includes(scq)))
              if (!list.length) return null
              return (
                <div key={g} className="shortcut-group">
                  <div className="shortcut-group-title">{g}{g === 'Editor' && <span className="muted small-text"> · while typing in a query or notebook cell</span>}</div>
                  {list.map((a) => {
                    const changed = a in s.shortcuts
                    const clashWith = clash.get(a)
                    return (
                      <div key={a} className={`shortcut-row ${clashWith ? 'clash' : ''}`}>
                        <span className="grow">{SHORTCUTS[a].label}
                          {clashWith && <span className="err-text small-text"> · same keys as “{SHORTCUTS[clashWith[0]].label}”</span>}
                        </span>
                        <button className={`kbd-btn ${recording === a ? 'rec' : ''}`} onClick={() => setRecording(a)} onBlur={() => setRecording(null)} onKeyDown={(e) => record(a, e)} title="Click, then press the new keys">
                          {recording === a ? 'Press keys…' : <Keys combo={shortcutFor(s, a)} />}
                        </button>
                        <button className="btn btn-sm ghost" disabled={!changed} onClick={() => setShortcut(a, undefined)} title={`Default: ${SHORTCUTS[a].key || 'off'}`}>Reset</button>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </> })}

          {Section({ id: 'results', children: <>
            <Row label="Row limit for query tabs" help="The most rows a query tab reads; you can change it per tab.">
              <select value={s.rowLimit} onChange={(e) => set({ rowLimit: Number(e.target.value) })}>
                {[1000, 10000, 50000, 100000, 0].map((n) => <option key={n} value={n}>{n ? n.toLocaleString() : 'All rows'}</option>)}
              </select>
            </Row>
            <Row label="Rows per page in table Data tabs">
              <select value={s.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })}>
                {[100, 200, 500, 1000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
              </select>
            </Row>
          </> })}

          {Section({ id: 'safety', children: <>
            <Row label="Ask before UPDATE or DELETE without WHERE"><Toggle checked={s.blockNoWhere} onChange={(v) => set({ blockNoWhere: v })} label="Block no-WHERE" /></Row>
            <Row label="Ask before every change on Production connections" help="Mark a connection as Production on the connection screen."><Toggle checked={s.confirmProduction} onChange={(v) => set({ confirmProduction: v })} label="Confirm production" /></Row>
          </> })}

          {Section({ id: 'ai', help: 'Use the AI service you prefer. Keys are encrypted with your Windows account and stay on this computer. The assistant receives table and column names and the query you ask about, never row data.', children: ai && (() => {
            const pi = aiProvider(ai.provider)
            const saved = aiCfg?.providers[ai.provider]
            const input = { provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl, key: key.trim() }
            const runAi = async (fn: () => Promise<void>) => { setAiBusy(true); setAiMsg(null); try { await fn() } catch (e) { setAiMsg({ ok: false, text: errMsg(e) }) } finally { setAiBusy(false) } }
            return <>
              <Row label="Provider" help={pi.note} wide>
                <div className="ai-providers">
                  {AI_PROVIDERS.map((p) => (
                    <button key={p.id} type="button" className={`ai-provider ${ai.provider === p.id ? 'on' : ''}`}
                      onClick={() => { if (aiCfg) setAi(aiFrom(aiCfg, p.id)); setKey(''); setAiMsg(null); setAiModels([]) }}>
                      <strong>{p.label}</strong>
                      <span className="muted small-text">{aiCfg?.providers[p.id]?.hasKey ? 'Key saved' : p.needsKey ? 'Needs an API key' : 'No key needed'}</span>
                    </button>
                  ))}
                </div>
              </Row>
              {(pi.needsKey || ai.provider === 'custom') && (
                <Row label={`${pi.label} API key`} help={pi.keyUrl ? <>Get one at <a href={pi.keyUrl} target="_blank" rel="noreferrer">{pi.keyUrl.replace('https://', '')}</a></> : ai.provider === 'custom' ? 'Only if your server needs one.' : undefined}>
                  <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={saved?.hasKey ? 'Saved (leave empty to keep it)' : pi.keyHint ?? 'Optional'} autoComplete="off" />
                </Row>
              )}
              {ai.provider !== 'anthropic' && (
                <Row label="Server address" help={ai.provider === 'custom' ? 'The OpenAI-compatible base URL, ending in /v1 for most servers.' : `Default: ${pi.baseUrl}`}>
                  <input value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} placeholder={pi.baseUrl} autoComplete="off" />
                </Row>
              )}
              <Row label="Model" help="Pick a suggestion or type any model name your provider offers.">
                <div className="input-group">
                  {/* A real dropdown: a datalist hides every suggestion that doesn't match the text already typed */}
                  <select value={[...new Set([...aiModels, ...pi.models])].includes(ai.model) ? ai.model : ''} onChange={(e) => { if (e.target.value) setAi({ ...ai, model: e.target.value }) }} title="Choose a model">
                    <option value="">{aiModels.length ? `${aiModels.length} models…` : 'Suggestions…'}</option>
                    {aiModels.length > 0 && <optgroup label="From your provider">{aiModels.map((m) => <option key={'l:' + m} value={m}>{m}</option>)}</optgroup>}
                    <optgroup label="Suggested">{pi.models.filter((m) => !aiModels.includes(m)).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                  </select>
                  <input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} placeholder={pi.defaultModel || 'model name'} autoComplete="off" />
                  <button type="button" className="btn btn-sm" disabled={aiBusy} onClick={() => runAi(async () => {
                    const list = await window.db.aiListModels(input)
                    setAiModels(list)
                    setAiMsg({ ok: true, text: list.length ? `${list.length} models found. Pick one from the dropdown.` : 'The provider listed no models.' })
                  })}>Load models</button>
                </div>
              </Row>
              <Row label="Check" help="Sends one tiny request with the settings above (before saving).">
                <div className="ai-test">
                  <button type="button" className="btn btn-sm" disabled={aiBusy} onClick={() => runAi(async () => setAiMsg({ ok: true, text: await window.db.aiTest(input) }))}>{aiBusy ? 'Checking…' : 'Test connection'}</button>
                  {saved?.hasKey && pi.needsKey && <button type="button" className="btn btn-sm ghost" onClick={async () => { await window.db.aiSetConfig({ ...input, key: null }); const c = await window.db.aiGetConfig(); setAiCfg(c); setAiMsg({ ok: true, text: 'Key removed' }) }}>Remove saved key</button>}
                </div>
              </Row>
              {aiMsg && <div className={`notice ${aiMsg.ok ? 'ok' : 'error'}`}>{aiMsg.text}</div>}
            </>
          })() })}

          {Section({ id: 'team', help: 'Team queries show up in the command palette. Connections are shared without passwords; each person enters their own.', children: <>
            <Row label="Shared folder" help="A OneDrive, Dropbox or network folder everyone can reach." wide>
              <div className="input-group">
                <input value={s.teamFolder} onChange={(e) => set({ teamFolder: e.target.value })} placeholder="\\server\share\qubase" />
                <button type="button" className="btn btn-sm" onClick={async () => { const f = await window.db.pickFolder(); if (f) set({ teamFolder: f }) }}>Browse</button>
              </div>
            </Row>
            <Row label="Share with the team">
              <div className="btn-row">
                <button className="btn btn-sm" disabled={!s.teamFolder} onClick={shareQueries}>My saved queries</button>
                <button className="btn btn-sm" disabled={!s.teamFolder} onClick={shareConns}>My connections</button>
              </div>
            </Row>
            {teamMsg && <p className="small-text pad">{teamMsg}</p>}
          </> })}

          {Section({ id: 'about', children: <>
            <Row label="Version"><strong>{version || '…'}</strong></Row>
            <Row label="Log file" help="Errors and crashes are written to a local log file. Nothing is sent anywhere.">
              <button className="btn btn-sm" onClick={() => window.db.openLogFolder()}>Open log folder</button>
            </Row>
            <Row label="Reset everything" help="Puts every setting and shortcut back to its default (not saved until you press Save).">
              <button className="btn btn-sm" onClick={() => setS({ ...DEFAULT_SETTINGS })}>Reset to defaults</button>
            </Row>
          </> })}
        </div>
      </div>
      {(dirty || error) && (
        <footer className="settings-bar">
          {error ? <span className="err-text">{error}</span> : <span>You have unsaved changes.</span>}
          <div className="spacer" />
          <button className="btn" onClick={() => { setS(saved0); setUserSnips(readUserSnippets()); setHidden(readHiddenSnippets()); setSnipsDirty(false); setKey(''); if (aiCfg) setAi(aiFrom(aiCfg, aiCfg.provider)); setAiMsg(null); setError('') }} disabled={!dirty}>Discard</button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty}>Save <span className="kbd-hint">Ctrl+S</span></button>
        </footer>
      )}
    </div>
  )
}

/** Cheat sheet of every shortcut (F1 by default) */
export function ShortcutsHelp({ settings, onClose, onEdit }: { settings: Settings; onClose: () => void; onEdit: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal shortcuts-help" role="dialog" aria-label="Keyboard shortcuts">
        <div className="modal-head"><strong>Keyboard shortcuts</strong><div className="spacer" /><button className="btn btn-sm" onClick={onEdit}>Change…</button><button className="icon-btn" onClick={onClose}><IconX /></button></div>
        <div className="modal-body shortcuts-grid">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g}>
              <div className="shortcut-group-title">{g}</div>
              {ACTIONS.filter((a) => SHORTCUTS[a].group === g).map((a) => (
                <div key={a} className="help-row"><span>{SHORTCUTS[a].label}</span><Keys combo={shortcutFor(settings, a)} /></div>
              ))}
              {g === 'Editor' && <>
                <div className="help-row"><span>Run (always)</span><Keys combo="F5" /></div>
                <div className="help-row"><span>Comment line</span><Keys combo="Ctrl+/" /></div>
                <div className="help-row"><span>Find / replace in the editor</span><Keys combo="Ctrl+F" /></div>
              </>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
