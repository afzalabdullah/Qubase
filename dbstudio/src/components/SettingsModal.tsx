import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ACCENTS, DEFAULT_SETTINGS, readSettings, Settings, shortcutFor, writeSettings } from '../settings'
import { IconPlus, IconSearch, IconTrash, IconX } from './Icons'
import { EDITOR_THEMES } from '../editorThemes'
import { BUILT_IN_SNIPPETS, readHiddenSnippets, readUserSnippets, Snippet, writeHiddenSnippets, writeUserSnippets } from '../snippets'
import { ACTIONS, comboFromEvent, conflicts, keyCaps, normalise, RESERVED, SHORTCUT_GROUPS, SHORTCUTS, ShortcutAction } from '../shortcuts'
import { errMsg } from '../util'
import { readSavedQueries } from '../saved'
import type { LicenceInfo } from '../../shared/types'

const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (best answers)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (fastest)']
] as const

export const SETTINGS_SECTIONS = [
  ['appearance', 'Appearance'],
  ['editor', 'Editor'],
  ['formatting', 'Formatting & snippets'],
  ['shortcuts', 'Keyboard shortcuts'],
  ['results', 'Results & data'],
  ['safety', 'Safety'],
  ['ai', 'AI assistant'],
  ['team', 'Team folder'],
  ['licence', 'Licence & updates'],
  ['about', 'Troubleshooting']
] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number][0]

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
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="toggle" title={label}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} /><span /></label>
}

/** Full-screen settings with a section list, search and an unsaved-changes bar. */
export function SettingsModal({ onClose, onSaved, section }: { onClose: () => void; onSaved: (s: Settings) => void; section?: SettingsSection }) {
  const [saved0] = useState<Settings>(readSettings)
  const [s, setS] = useState<Settings>(saved0)
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [error, setError] = useState('')
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
    window.db.aiHasKey().then(setHasKey).catch(() => setHasKey(false))
    window.db.appVersion().then(setVersion).catch(() => {})
    window.db.getLicence().then(setLicence).catch(() => {})
  }, [])

  const dirty = JSON.stringify(s) !== JSON.stringify(saved0) || snipsDirty || !!key
  const clash = useMemo(() => conflicts((a) => shortcutFor(s, a)), [s])

  const save = async () => {
    try {
      if (clash.size) { const [a, others] = [...clash.entries()][0]; setError(`${normalise(shortcutFor(s, a))} is used for both “${SHORTCUTS[a].label}” and “${SHORTCUTS[others[0]].label}”. Change one of them first.`); jump('shortcuts'); return }
      writeSettings(s)
      writeUserSnippets(userSnips)
      writeHiddenSnippets(hidden)
      if (key || hasKey) await window.db.aiSetKey(key.trim(), s.aiModel)
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

  const Section = ({ id, children, help }: { id: SettingsSection; children: ReactNode; help?: ReactNode }) => {
    const title = SETTINGS_SECTIONS.find((x) => x[0] === id)![1]
    return (
      <section id={`set-${id}`} className="settings-section" data-title={title}>
        <h3>{title}</h3>
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
        <div className="spacer" />
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
          {Section({ id: 'appearance', children: <>
            <Row label="Theme" help="“Same as Windows” follows your Windows light / dark setting.">
              <select value={s.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
                <option value="system">Same as Windows</option><option value="light">Light</option><option value="dark">Dark</option>
              </select>
            </Row>
            <Row label="Accent colour" help="Buttons, highlights and the active tab.">
              <div className="color-row">
                {Object.entries(ACCENTS).map(([id, a]) => (
                  <button key={id} type="button" className={`swatch ${s.accent === id ? 'on' : ''}`} style={{ background: a.light }} title={a.label} onClick={() => set({ accent: id })} />
                ))}
              </div>
            </Row>
            <Row label="Editor colours">
              <select value={s.editorTheme} onChange={(e) => set({ editorTheme: e.target.value })}>
                {EDITOR_THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </Row>
            <Row label="Font size" help="Editor and result grid, 10–24.">
              <input type="number" min={10} max={24} value={s.fontSize} onChange={(e) => set({ fontSize: Math.min(24, Math.max(10, Number(e.target.value) || 13)) })} />
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

          {Section({ id: 'ai', help: 'The key is encrypted with your Windows account and stays on this computer. The assistant receives table and column names and the query you ask about, never row data.', children: <>
            <Row label="Anthropic API key">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? 'Saved (leave empty to keep it)' : 'sk-ant-…'} autoComplete="off" />
            </Row>
            <Row label="Model">
              <select value={s.aiModel} onChange={(e) => set({ aiModel: e.target.value })}>{MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            </Row>
          </> })}

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

          {Section({ id: 'licence', children: <>
            <Row label="Version"><strong>{version || '…'}</strong></Row>
            {licence?.valid
              ? <Row label="Licence" help={`${licence.plan ?? 'pro'}${licence.seats ? ` · ${licence.seats} seat${licence.seats > 1 ? 's' : ''}` : ''}${licence.expires ? ` · until ${licence.expires}` : ''}`}>
                  <span>Licensed to <strong>{licence.name}</strong></span>
                  <button className="btn btn-sm" onClick={async () => { await window.db.clearLicence(); setLicence({ valid: false }) }}>Remove</button>
                </Row>
              : <Row label="Licence key" help={licence?.error ? <span className="err-text">{licence.error}</span> : undefined} wide>
                  <div className="input-group">
                    <input value={licenceKey} onChange={(e) => setLicenceKey(e.target.value)} placeholder="Paste your key" autoComplete="off" />
                    <button type="button" className="btn btn-sm" disabled={!licenceKey.trim()} onClick={activate}>Activate</button>
                  </div>
                </Row>}
            <Row label="Update address" help={updateMsg || 'An https folder with latest.yml and the installer.'} wide>
              <div className="input-group">
                <input value={s.updateUrl} onChange={(e) => set({ updateUrl: e.target.value })} placeholder="https://downloads.example.com/qubase" />
                <button type="button" className="btn btn-sm" disabled={!s.updateUrl} onClick={checkUpdate}>Check now</button>
              </div>
            </Row>
          </> })}

          {Section({ id: 'about', children: <>
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
          <button className="btn" onClick={() => { setS(saved0); setUserSnips(readUserSnippets()); setHidden(readHiddenSnippets()); setSnipsDirty(false); setKey(''); setError('') }} disabled={!dirty}>Discard</button>
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
