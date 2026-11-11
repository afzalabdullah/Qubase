import logo from '../assets/logo.svg'
import { useEffect, useState } from 'react'
import { DRIVERS, driverFor, DbKind } from '../../shared/drivers'
import type { ConnectionConfig, SavedConnection } from '../../shared/types'
import { DbBadge } from './DbBadge'
import { IconCheck, IconFolder, IconPlus, IconTrash } from './Icons'
import { errMsg } from '../util'

const COLORS = ['', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

function blankConfig(kind: DbKind): ConnectionConfig {
  const d = driverFor(kind)
  return {
    kind,
    host: d.mode === 'server' ? 'localhost' : undefined,
    region: kind === 'dynamodb' ? 'us-east-1' : undefined,
    datacenter: kind === 'cassandra' ? 'datacenter1' : undefined,
    port: d.defaultPort,
    user: d.defaultUser ?? '',
    password: '',
    database: d.defaultDatabase ?? '',
    ssl: d.defaultSsl ?? false,
    trustServerCertificate: d.engine === 'mssql' ? true : undefined
  }
}

const newId = () => crypto.randomUUID()

type Category = 'all' | 'sql' | 'cloud' | 'nosql' | 'file'
const CATEGORIES: [Category, string][] = [['all', 'All'], ['sql', 'Relational'], ['cloud', 'Cloud & warehouse'], ['nosql', 'NoSQL'], ['file', 'File & embedded']]
const CATEGORY: Record<DbKind, Category> = {
  postgres: 'sql', mysql: 'sql', mariadb: 'sql', mssql: 'sql', oracle: 'sql', cockroach: 'sql', timescale: 'sql', yugabyte: 'sql', tidb: 'sql',
  azuresql: 'cloud', redshift: 'cloud', snowflake: 'cloud', bigquery: 'cloud', dynamodb: 'cloud', clickhouse: 'cloud', trino: 'cloud',
  mongodb: 'nosql', redis: 'nosql', cassandra: 'nosql',
  sqlite: 'file', duckdb: 'file', libsql: 'file'
} as Record<DbKind, Category>

/** Read postgres://user:pass@host:port/db?sslmode=require (and similar) into form fields. */
export function parseConnUrl(text: string): Partial<ConnectionConfig> | null {
  try {
    const u = new URL(text.trim())
    if (!u.hostname) return null
    const q = u.searchParams
    const ssl = /s:$/.test(u.protocol) || ['require', 'verify-ca', 'verify-full', 'true'].includes((q.get('sslmode') ?? q.get('ssl') ?? q.get('encrypt') ?? '').toLowerCase())
    const out: Partial<ConnectionConfig> = { host: u.hostname }
    if (u.port) out.port = Number(u.port)
    if (u.username) out.user = decodeURIComponent(u.username)
    if (u.password) out.password = decodeURIComponent(u.password)
    const db = decodeURIComponent(u.pathname.replace(/^\//, ''))
    if (db) out.database = db
    if (ssl) out.ssl = true
    return out
  } catch { return null }
}

interface Props {
  onConnected: (id: string, canEdit: boolean, conn: SavedConnection) => void
}

export function ConnectionScreen({ onConnected }: Props) {
  const [saved, setSaved] = useState<SavedConnection[]>([])
  const [draft, setDraft] = useState<SavedConnection>({ id: newId(), name: '', config: blankConfig('postgres') })
  const [status, setStatus] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState<'' | 'test' | 'connect'>('')
  const [section, setSection] = useState<'' | 'ssh' | 'ssl' | 'safety'>('')
  const [cat, setCat] = useState<Category>('all')
  const [typeQ, setTypeQ] = useState('')
  const [picking, setPicking] = useState(true)
  const [quick, setQuick] = useState('')

  useEffect(() => { window.db.listSaved().then(setSaved) }, [])
  const [filter, setFilter] = useState('')
  const [closed, setClosed] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('closedGroups') ?? '[]')) } catch { return new Set() } })

  const cfg = draft.config
  const driver = driverFor(cfg.kind)
  const isSaved = saved.some((s) => s.id === draft.id)
  const set = (patch: Partial<ConnectionConfig>) => setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }))

  const pickType = (kind: DbKind) => {
    setDraft((d) => ({ ...d, config: { ...blankConfig(kind), password: '' } }))
    setStatus(null); setPicking(false); setQuick('')
  }
  const types = DRIVERS.filter((d) => (cat === 'all' || CATEGORY[d.kind] === cat) && d.label.toLowerCase().includes(typeQ.trim().toLowerCase()))
  const fillFromUrl = (text: string) => {
    setQuick(text)
    const p = parseConnUrl(text)
    if (p) { set(p); setStatus({ kind: 'ok', text: 'Filled in from the URL' }) }
  }

  const newConnection = () => {
    setDraft({ id: newId(), name: '', config: blankConfig('postgres') })
    setStatus(null); setPicking(true); setQuick('')
  }

  /** Saved connections by group; ungrouped ones first */
  const groups = (() => {
    const m = new Map<string, SavedConnection[]>()
    for (const s of saved.filter((x) => !filter || `${x.name} ${x.config.host ?? ''} ${x.group ?? ''}`.toLowerCase().includes(filter.toLowerCase()))) {
      const g = s.group?.trim() || ''
      m.set(g, [...(m.get(g) ?? []), s])
    }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  })()
  const toggleGroup = (g: string) => setClosed((c) => { const n = new Set(c); if (n.has(g)) n.delete(g); else n.add(g); try { localStorage.setItem('closedGroups', JSON.stringify([...n])) } catch { /* ignore */ } return n })

  /** Export to JSON without passwords or tokens, so the file is safe to share */
  const exportConns = async () => {
    const clean = saved.map((s) => {
      const config = { ...s.config, password: undefined, authToken: undefined }
      if (config.ssh) config.ssh = { ...config.ssh, password: undefined, passphrase: undefined }
      return { ...s, config }
    })
    const p = await window.db.saveTextFile(JSON.stringify({ app: 'qubase', kind: 'connections', version: 1, connections: clean }, null, 2), { name: 'qubase-connections', filter: 'Qubase connections', ext: 'json' })
    if (p) setStatus({ kind: 'ok', text: `Exported ${clean.length} connections (without passwords)` })
  }
  const importConns = async () => {
    try {
      const f = await window.db.openTextFile({ filter: 'Qubase connections', ext: 'json' })
      if (!f) return
      const data = JSON.parse(f.content)
      const list: SavedConnection[] = Array.isArray(data) ? data : data.connections
      if (!Array.isArray(list)) throw new Error('This file has no connections')
      let latest = saved
      for (const c of list) {
        if (!c?.config?.kind) continue
        const id = latest.some((x) => x.id === c.id) || !c.id ? newId() : c.id
        latest = await window.db.saveConnection({ ...c, id })
      }
      setSaved(latest)
      setStatus({ kind: 'ok', text: `Imported ${list.length} connections. Enter passwords before connecting.` })
    } catch (e) { setStatus({ kind: 'error', text: `Import failed: ${e instanceof Error ? e.message : String(e)}` }) }
  }

  const displayName = (c: SavedConnection) =>
    c.name ||
    (c.config.file ?? c.config.url ?? (c.config.kind === 'dynamodb' ? `DynamoDB ${c.config.region ?? ''}` : `${c.config.user ? c.config.user + '@' : ''}${c.config.host ?? ''}${c.config.database ? '/' + c.config.database : ''}`))

  const test = async () => {
    setBusy('test'); setStatus(null)
    try {
      await window.db.test(cfg)
      setStatus({ kind: 'ok', text: 'Connection looks good' })
    } catch (e) {
      setStatus({ kind: 'error', text: errMsg(e) })
    } finally { setBusy('') }
  }

  const save = async () => {
    setSaved(await window.db.saveConnection(draft))
    setStatus({ kind: 'ok', text: 'Saved' })
  }

  const remove = async (id: string) => {
    setSaved(await window.db.deleteSaved(id))
    if (id === draft.id) newConnection()
  }

  const connect = async (conn = draft) => {
    setBusy('connect'); setStatus(null)
    try {
      const { id, canEdit } = await window.db.connect(conn.config)
      onConnected(id, canEdit, conn)
    } catch (e) {
      setStatus({ kind: 'error', text: errMsg(e) })
    } finally { setBusy('') }
  }

  const browse = async () => {
    const f = await window.db.pickFile('db')
    if (f) set({ file: f })
  }
  const ssh = cfg.ssh ?? { enabled: false, host: '', port: 22, user: '' }
  const setSsh = (patch: Partial<typeof ssh>) => set({ ssh: { ...ssh, ...patch } })
  const pickInto = async (fn: (v: string) => void) => { const f = await window.db.pickFile('any'); if (f) fn(f) }

  return (
    <div className="connect-screen">
      <aside className="saved-panel">
        <div className="brand"><img src={logo} width={22} height={22} alt="" /> Qubase</div>
        <button className="btn btn-primary btn-block" onClick={newConnection}><IconPlus /> New Connection</button>
        <div className="section-label saved-head">Saved connections
          <span className="spacer" />
          <button className="link-btn" onClick={importConns} title="Import connections from a JSON file">Import</button>
          <button className="link-btn" onClick={exportConns} disabled={!saved.length} title="Export connections to JSON (passwords are left out)">Export</button>
        </div>
        {saved.length > 0 && <input className="saved-filter" placeholder="Search connections…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        <ul className="saved-list">
          {saved.length === 0 && <li className="empty">Nothing saved yet</li>}
          {groups.map(([g, items]) => [
            g && <li key={'g:' + g} className="saved-group" onClick={() => toggleGroup(g)}>{closed.has(g) ? '▸' : '▾'} {g} <span className="muted">{items.length}</span></li>,
            ...(g && closed.has(g) ? [] : items).map((s) => (
            <li
              key={s.id}
              className={s.id === draft.id ? 'active' : ''}
              onClick={() => { setDraft(s); setStatus(null); setPicking(false) }}
              onDoubleClick={() => connect(s)}
              style={s.color ? { boxShadow: `inset 3px 0 ${s.color}` } : undefined}
            >
              <DbBadge kind={s.config.kind} size={24} />
              <div className="saved-text">
                <div className="saved-name">{displayName(s)}</div>
                <div className="saved-sub">{driverFor(s.config.kind).label}{s.production ? ' · Production' : ''}{s.readOnly ? ' · Read-only' : ''}</div>
              </div>
              <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); remove(s.id) }}><IconTrash /></button>
            </li>
          ))])}
        </ul>
      </aside>

      <main className="connect-main">
        <div className="connect-content">
          <div className="connect-head">
            <div>
              <h1>{isSaved ? 'Edit connection' : 'New connection'}</h1>
              <p className="subtitle">{picking ? 'Pick the database you want to connect to.' : 'Fill in the details, test, then connect.'}</p>
            </div>
          </div>

          {picking ? (
            <section className="type-picker">
              <div className="type-tools">
                <div className="settings-search small type-search">
                  <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                  <input autoFocus placeholder="Search databases…" value={typeQ} onChange={(e) => setTypeQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && types[0]) pickType(types[0].kind) }} />
                </div>
                <div className="seg">
                  {CATEGORIES.map(([k, l]) => <button key={k} type="button" className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{l}</button>)}
                </div>
              </div>
              <div className="type-grid">
                {types.map((d) => (
                  <button key={d.kind} className={`type-tile ${cfg.kind === d.kind ? 'selected' : ''}`} onClick={() => pickType(d.kind)}>
                    <DbBadge kind={d.kind} size={36} />
                    <span>{d.label}</span>
                  </button>
                ))}
                {types.length === 0 && <p className="muted">No database matches “{typeQ}”.</p>}
              </div>
            </section>
          ) : (
            <div className="type-chosen">
              <DbBadge kind={cfg.kind} size={44} />
              <div className="type-chosen-text">
                <div className="type-chosen-name">{driver.label}</div>
                <div className="muted small-text">{CATEGORIES.find(([k]) => k === CATEGORY[cfg.kind])?.[1]}{driver.defaultPort ? ` · default port ${driver.defaultPort}` : ''}</div>
              </div>
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setPicking(true)}>Change type</button>
            </div>
          )}

          {!picking && <form className="conn-form" onSubmit={(e) => { e.preventDefault(); connect() }}>
            <div className="form-section span-2">Connection</div>
            {driver.mode === 'file' && (
              <label className="field span-2">
                <span>Database file</span>
                <div className="input-group">
                  <input value={cfg.file ?? ''} onChange={(e) => set({ file: e.target.value })} placeholder={cfg.kind === 'duckdb' ? 'C:\\data\\analytics.duckdb' : 'C:\\data\\app.db'} />
                  <button type="button" className="btn" onClick={browse}><IconFolder /> Browse</button>
                </div>
              </label>
            )}

            {driver.mode === 'url' && (
              <>
                <label className="field span-2"><span>Database URL</span>
                  <input value={cfg.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="libsql://my-db-user.turso.io  or  file:C:/data/local.db" />
                </label>
                <label className="field span-2"><span>Auth token</span>
                  <input type="password" value={cfg.authToken ?? ''} onChange={(e) => set({ authToken: e.target.value })} placeholder="Optional for local files" />
                </label>
              </>
            )}

            {driver.mode === 'cloud' && <CloudFields cfg={cfg} set={set} pick={pickInto} />}

            {driver.mode === 'server' && (driver.engine === 'mongodb' || driver.engine === 'redis') && (
              <label className="field span-2">
                <span>Connection string <span className="muted">(optional, overrides the fields below)</span></span>
                <input value={cfg.url ?? ''} onChange={(e) => set({ url: e.target.value })}
                  placeholder={driver.engine === 'mongodb' ? 'mongodb+srv://user:pass@cluster0.example.mongodb.net/mydb' : 'redis://user:pass@localhost:6379/0'} />
              </label>
            )}

            {driver.mode === 'server' && driver.engine !== 'mongodb' && driver.engine !== 'redis' && (
              <label className="field span-2 quick-url"><span>Paste a connection URL <span className="muted">(optional, fills the fields below)</span></span>
                <input value={quick} onChange={(e) => fillFromUrl(e.target.value)} placeholder={`${driver.engine === 'mssql' ? 'sqlserver' : driver.engine}://user:password@host:${driver.defaultPort ?? 5432}/database`} autoComplete="off" />
              </label>
            )}

            {driver.mode === 'server' && (
              <>
                <label className="field"><span>Host</span><input value={cfg.host ?? ''} onChange={(e) => set({ host: e.target.value })} /></label>
                <label className="field"><span>Port</span><input type="number" value={cfg.port ?? ''} onChange={(e) => set({ port: Number(e.target.value) || undefined })} /></label>
                {driver.engine === 'mssql' && (
                  <>
                    <label className="field"><span>Authentication</span>
                      <select value={cfg.authType ?? 'sql'} onChange={(e) => set({ authType: e.target.value as 'sql' | 'ntlm' })}>
                        <option value="sql">SQL Server login</option>
                        <option value="ntlm">Windows / domain account (NTLM)</option>
                      </select>
                    </label>
                    {cfg.authType === 'ntlm'
                      ? <label className="field"><span>Domain</span><input value={cfg.domain ?? ''} onChange={(e) => set({ domain: e.target.value })} placeholder="e.g. CONTOSO" /></label>
                      : <div />}
                  </>
                )}
                <label className="field"><span>{cfg.authType === 'ntlm' && driver.engine === 'mssql' ? 'Windows user' : 'User'}</span><input value={cfg.user ?? ''} onChange={(e) => set({ user: e.target.value })} /></label>
                <label className="field"><span>Password</span><input type="password" value={cfg.password ?? ''} onChange={(e) => set({ password: e.target.value })} /></label>
                <label className={`field ${driver.engine === 'cassandra' || driver.engine === 'trino' ? '' : 'span-2'}`}><span>{driver.databaseLabel ?? 'Default database'}</span>
                  <input value={cfg.database ?? ''} onChange={(e) => set({ database: e.target.value })} placeholder={driver.engine === 'trino' ? 'e.g. hive (needed to list tables)' : 'Optional'} />
                </label>
                {driver.engine === 'cassandra' && (
                  <label className="field"><span>Local data centre</span><input value={cfg.datacenter ?? ''} onChange={(e) => set({ datacenter: e.target.value })} placeholder="datacenter1" /></label>
                )}
                {driver.engine === 'trino' && (
                  <label className="field"><span>Schema</span><input value={cfg.schema ?? ''} onChange={(e) => set({ schema: e.target.value })} placeholder="Optional" /></label>
                )}
                {driver.engine === 'cassandra' && <p className="muted small-text span-2">Several hosts can be separated by commas.</p>}
                <div className="checks span-2">
                  <label className="check"><input type="checkbox" checked={!!cfg.ssl} onChange={(e) => set({ ssl: e.target.checked })} /> Enable SSL / TLS</label>
                  {driver.engine === 'mssql' && (
                    <label className="check"><input type="checkbox" checked={!!cfg.trustServerCertificate} onChange={(e) => set({ trustServerCertificate: e.target.checked })} /> Trust server certificate</label>
                  )}
                </div>
              </>
            )}

            <div className="form-section span-2">Advanced</div>
            <div className="adv-tabs span-2">
              {driver.mode === 'server' && <button type="button" className={section === 'ssh' ? 'on' : ''} onClick={() => setSection(section === 'ssh' ? '' : 'ssh')}>SSH tunnel{ssh.enabled ? ' ●' : ''}</button>}
              {driver.mode === 'server' && ['postgres', 'mysql', 'mongodb'].includes(driver.engine) &&
                <button type="button" className={section === 'ssl' ? 'on' : ''} onClick={() => setSection(section === 'ssl' ? '' : 'ssl')}>SSL certificates{cfg.sslCa ? ' ●' : ''}</button>}
              <button type="button" className={section === 'safety' ? 'on' : ''} onClick={() => setSection(section === 'safety' ? '' : 'safety')}>
                Safety{draft.production ? ' · Production' : ''}{draft.readOnly ? ' · Read-only' : ''}
              </button>
            </div>

            {section === 'ssh' && (
              <>
                <label className="check span-2"><input type="checkbox" checked={ssh.enabled} onChange={(e) => setSsh({ enabled: e.target.checked })} /> Connect through an SSH server</label>
                {ssh.enabled && (
                  <>
                    <label className="field"><span>SSH host</span><input value={ssh.host} onChange={(e) => setSsh({ host: e.target.value })} placeholder="bastion.example.com" /></label>
                    <label className="field"><span>SSH port</span><input type="number" value={ssh.port ?? 22} onChange={(e) => setSsh({ port: Number(e.target.value) || 22 })} /></label>
                    <label className="field"><span>SSH user</span><input value={ssh.user} onChange={(e) => setSsh({ user: e.target.value })} /></label>
                    <label className="field"><span>SSH password</span><input type="password" value={ssh.password ?? ''} onChange={(e) => setSsh({ password: e.target.value })} placeholder="Or use a private key" /></label>
                    <label className="field span-2"><span>Private key file (optional)</span>
                      <div className="input-group">
                        <input value={ssh.privateKeyPath ?? ''} onChange={(e) => setSsh({ privateKeyPath: e.target.value })} placeholder="id_rsa" />
                        <button type="button" className="btn" onClick={() => pickInto((v) => setSsh({ privateKeyPath: v }))}><IconFolder /> Browse</button>
                      </div>
                    </label>
                    <label className="field span-2"><span>Key passphrase</span><input type="password" value={ssh.passphrase ?? ''} onChange={(e) => setSsh({ passphrase: e.target.value })} placeholder="If the key has one" /></label>
                    <p className="muted small-text span-2">Host and port above are the database as seen from the SSH server (often localhost).</p>
                  </>
                )}
              </>
            )}

            {section === 'ssl' && (
              <>
                {([['sslCa', 'CA certificate (verifies the server)', 'ca.pem'], ['sslCert', 'Client certificate (optional)', 'client-cert.pem'], ['sslKey', 'Client key (optional)', 'client-key.pem']] as const).map(([key, label, ph]) => (
                  <label key={key} className="field span-2"><span>{label}</span>
                    <div className="input-group">
                      <input value={cfg[key] ?? ''} onChange={(e) => set({ [key]: e.target.value || undefined })} placeholder={ph} />
                      <button type="button" className="btn" onClick={() => pickInto((v) => set({ [key]: v, ...(key === 'sslCa' ? { ssl: true } : {}) }))}><IconFolder /> Browse</button>
                    </div>
                  </label>
                ))}
              </>
            )}

            {section === 'safety' && (
              <div className="checks span-2 safety-box">
                <label className="check"><input type="checkbox" checked={!!draft.production} onChange={(e) => setDraft((d) => ({ ...d, production: e.target.checked, color: e.target.checked && !d.color ? '#ef4444' : d.color }))} />
                  <span><strong>Production</strong>: red warning bar, asks before every change</span></label>
                <label className="check"><input type="checkbox" checked={!!draft.readOnly} onChange={(e) => setDraft((d) => ({ ...d, readOnly: e.target.checked }))} />
                  <span><strong>Read-only</strong>: blocks INSERT, UPDATE, DELETE, CREATE, ALTER, DROP and other changes</span></label>
              </div>
            )}

            <div className="form-section span-2">Save as</div>

            <label className="field"><span>Connection name</span>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Production DB" />
            </label>
            <label className="field"><span>Group</span>
              <input value={draft.group ?? ''} list="conn-groups" onChange={(e) => setDraft((d) => ({ ...d, group: e.target.value || undefined }))} placeholder="e.g. Client A, Work, Personal" />
              <datalist id="conn-groups">{[...new Set(saved.map((s) => s.group).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist>
            </label>
            <div className="field"><span>Colour</span>
              <div className="color-row">
                {COLORS.map((c) => (
                  <button type="button" key={c || 'none'} className={`swatch ${draft.color === c || (!draft.color && !c) ? 'on' : ''}`}
                    style={{ background: c || 'transparent' }} onClick={() => setDraft((d) => ({ ...d, color: c || undefined }))} title={c || 'None'} />
                ))}
              </div>
            </div>

            {status && <div className={`notice ${status.kind} span-2`}>{status.kind === 'ok' && <IconCheck />} {status.text}</div>}

            <div className="form-actions span-2 sticky-actions">
              <button type="button" className="btn" onClick={test} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Test'}</button>
              <button type="button" className="btn" onClick={save}>{isSaved ? 'Save changes' : 'Save'}</button>
              <button type="submit" className="btn btn-primary" disabled={!!busy}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</button>
            </div>
          </form>}
        </div>
      </main>
    </div>
  )
}

/** Sign-in fields for cloud warehouses (Snowflake, BigQuery, DynamoDB) */
function CloudFields({ cfg, set, pick }: { cfg: ConnectionConfig; set: (p: Partial<ConnectionConfig>) => void; pick: (fn: (v: string) => void) => void }) {
  const field = (label: string, key: keyof ConnectionConfig, ph = '', type = 'text', wide = false) => (
    <label key={key} className={`field ${wide ? 'span-2' : ''}`}><span>{label}</span>
      <input type={type} value={(cfg[key] as string) ?? ''} onChange={(e) => set({ [key]: e.target.value || undefined })} placeholder={ph} autoComplete="off" />
    </label>
  )
  if (cfg.kind === 'snowflake') return (
    <>
      {field('Account identifier', 'host', 'xy12345.eu-west-1  or  myorg-myaccount', 'text', true)}
      {field('User', 'user')}
      {field('Password', 'password', '', 'password')}
      {field('Warehouse', 'warehouse', 'COMPUTE_WH')}
      {field('Role', 'role', 'Optional')}
      {field('Database', 'database', 'Optional')}
      {field('Schema', 'schema', 'Optional')}
    </>
  )
  if (cfg.kind === 'bigquery') return (
    <>
      <label className="field span-2"><span>Service-account key file (JSON)</span>
        <div className="input-group">
          <input value={cfg.keyFile ?? ''} onChange={(e) => set({ keyFile: e.target.value || undefined })} placeholder="Empty = your gcloud sign-in (application default credentials)" />
          <button type="button" className="btn" onClick={() => pick((v) => set({ keyFile: v }))}><IconFolder /> Browse</button>
        </div>
      </label>
      {field('Project ID', 'host', 'Empty = the project in the key file')}
      {field('Location', 'region', 'e.g. US or europe-west2 (optional)')}
      {field('Default dataset', 'database', 'Optional: show only this dataset', 'text', true)}
    </>
  )
  return (
    <>
      {field('Region', 'region', 'us-east-1')}
      {field('Endpoint URL', 'url', 'Optional, e.g. http://localhost:8000 for DynamoDB Local')}
      {field('Access key ID', 'user', 'Empty = your AWS profile / environment')}
      {field('Secret access key', 'password', '', 'password')}
      {field('Session token', 'authToken', 'Only for temporary credentials', 'password', true)}
    </>
  )
}
