import { createClient, RedisClientType } from 'redis'
import type { DbClient } from './base'
import type { ColumnInfo, ConnectionConfig, QueryResult, RowUpdate, TableInfo } from '../../shared/types'

const MAX_KEYS = 5000

/** Turn the Redis driver's terse errors into a message that says what to fix. */
export function explainRedisError(e: Error & { code?: string }, host: string, port: number, tls: boolean): string {
  const m = e?.message || String(e)
  const where = `${host}:${port}`
  if (/WRONGPASS|invalid username-password/i.test(m)) return `Redis refused the login at ${where}: wrong user name or password. Cloud servers usually use the user "default".`
  if (/NOAUTH|Authentication required/i.test(m)) return `Redis at ${where} needs a password. Enter it in Password, or paste the full URL (redis://user:password@host:port).`
  if (/SNI|servername/i.test(m)) return `Redis at ${where} needs a secure connection with the server name. Use a rediss:// URL or tick "Enable SSL / TLS".`
  if (e?.code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo/i.test(m)) return `Could not find the server "${host}". Check the host name and your internet connection.`
  if (e?.code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(m)) return `Nothing is accepting connections at ${where}. Check the host and port, and that Redis is running.`
  if (/timeout|ETIMEDOUT/i.test(m)) return `No answer from ${where} within 8 seconds. A firewall may be blocking the port, or the host or port is wrong.`
  if (/Socket closed unexpectedly|ECONNRESET/i.test(m)) return tls
    ? `The server at ${where} closed the secure connection. Check the port, and whether this server supports TLS.`
    : `The server at ${where} closed the connection. Most cloud Redis servers need encryption: use a rediss:// URL (two s) or tick "Enable SSL / TLS".`
  if (/certificate|self.signed|CERT_/i.test(m)) return `The server's TLS certificate could not be verified (${m}).`
  if (/wrong version number|EPROTO/i.test(m)) return `This port does not speak TLS. Untick "Enable SSL / TLS" or use redis:// instead of rediss://.`
  return `Could not connect to Redis at ${where}: ${m}`
}

/** Split a command line into arguments, honouring "double" and 'single' quotes. */
export function splitArgs(line: string): string[] {
  const out: string[] = []
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(.)/g, (_s, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)))
    else if (m[2] !== undefined) out.push(m[2].replace(/\\'/g, "'"))
    else out.push(m[3])
  }
  return out
}

/** Turn any Redis reply into grid rows. */
function replyToRows(reply: unknown): { columns: string[]; rows: Record<string, unknown>[] } {
  if (Array.isArray(reply)) {
    return { columns: ['#', 'value'], rows: reply.map((v, i) => ({ '#': i, value: Array.isArray(v) ? JSON.stringify(v) : v })) }
  }
  if (reply && typeof reply === 'object') {
    return { columns: ['field', 'value'], rows: Object.entries(reply).map(([field, value]) => ({ field, value })) }
  }
  return { columns: ['result'], rows: [{ result: reply }] }
}

/**
 * Redis: each key appears as a "table". Opening a key shows its contents
 * in a shape that suits its type (hash fields, list items, set members…).
 * The query tab is a command console: one command per line.
 */
export class RedisClient implements DbClient {
  readonly canEdit = true
  private client?: RedisClientType

  constructor(private config: ConnectionConfig) {}

  async connect() {
    const c = this.config
    // Read a redis:// or rediss:// URL into parts so TLS can send the server name (SNI).
    // Cloud hosts that route by server name refuse the connection without it.
    let host = c.host || 'localhost', port = c.port || 6379, tls = !!c.ssl, user = c.user, password = c.password, db = Number(c.database) || 0
    if (c.url) {
      let u: URL
      try { u = new URL(c.url.trim()) } catch { throw new Error('The connection string is not a valid URL. Expected redis://user:password@host:port or rediss://… for TLS.') }
      host = u.hostname || host
      port = Number(u.port) || 6379
      tls = u.protocol === 'rediss:' || tls
      if (u.username) user = decodeURIComponent(u.username)
      if (u.password) password = decodeURIComponent(u.password)
      const path = u.pathname.replace(/^\//, '')
      if (path) db = Number(path) || 0
    }
    this.client = createClient({
      socket: tls
        ? { host, port, tls: true, servername: host, connectTimeout: 8000, reconnectStrategy: false }
        : { host, port, connectTimeout: 8000, reconnectStrategy: false },
      username: user || undefined,
      password: password || undefined,
      database: db
    }) as RedisClientType
    let last: Error | undefined
    this.client.on('error', (e: Error) => { last = e })
    try {
      await this.client.connect()
    } catch (e) {
      try { await this.client.disconnect() } catch { /* already closed */ }
      throw new Error(explainRedisError((last ?? e) as Error, host, port, tls))
    }
  }

  async disconnect() { if (this.client?.isOpen) await this.client.quit() }

  private get c() {
    if (!this.client) throw new Error('Not connected')
    return this.client
  }

  private cmd(args: string[]): Promise<unknown> { return this.c.sendCommand(args) as Promise<unknown> }

  async listDatabases() {
    let count = 16
    try {
      const r = (await this.cmd(['CONFIG', 'GET', 'databases'])) as unknown
      const v = Array.isArray(r) ? r[1] : (r as Record<string, string>)?.databases
      if (Number(v) > 0) count = Number(v)
    } catch { /* CONFIG may be disabled (managed Redis); assume 16 */ }
    return { databases: Array.from({ length: count }, (_, i) => String(i)), current: String(Number(this.config.database) || 0) }
  }

  async listTables(): Promise<TableInfo[]> {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = (await this.cmd(['SCAN', cursor, 'COUNT', '1000'])) as [string, string[]]
      keys.push(...batch)
      cursor = next
    } while (cursor !== '0' && keys.length < MAX_KEYS)
    // Group keys by type, shown as the "schema" in the sidebar
    const types = await Promise.all(keys.map((k) => this.cmd(['TYPE', k]) as Promise<string>))
    return keys
      .map((name, i) => ({ schema: types[i], name, type: 'table' as const }))
      .sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name))
  }

  private async typeOf(key: string) { return (await this.cmd(['TYPE', key])) as string }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const type = await this.typeOf(t.name)
    const col = (name: string, pk = false): ColumnInfo => ({ name, dataType: type, nullable: false, primaryKey: pk })
    switch (type) {
      case 'string': return [col('key', true), col('value')]
      case 'hash': return [col('field', true), col('value')]
      case 'list': return [col('index', true), col('value')]
      case 'set': return [col('member')]
      case 'zset': return [col('member', true), col('score')]
      case 'stream': return [col('id'), col('fields')]
      default: return [col('value')]
    }
  }

  async selectTop(t: TableInfo, limit: number): Promise<QueryResult> {
    const start = performance.now()
    const key = t.name
    const n = Math.max(1, Math.min(limit, 50000))
    const type = await this.typeOf(key)
    let columns: string[] = []
    let rows: Record<string, unknown>[] = []
    switch (type) {
      case 'string':
        columns = ['key', 'value']
        rows = [{ key, value: await this.cmd(['GET', key]) }]
        break
      case 'hash': {
        const flat = (await this.cmd(['HSCAN', key, '0', 'COUNT', String(n)]))as [string, string[]]
        columns = ['field', 'value']
        for (let i = 0; i < flat[1].length; i += 2) rows.push({ field: flat[1][i], value: flat[1][i + 1] })
        break
      }
      case 'list': {
        const items = (await this.cmd(['LRANGE', key, '0', String(n - 1)])) as string[]
        columns = ['index', 'value']
        rows = items.map((value, index) => ({ index, value }))
        break
      }
      case 'set': {
        const [, members] = (await this.cmd(['SSCAN', key, '0', 'COUNT', String(n)])) as [string, string[]]
        columns = ['member']
        rows = members.map((member) => ({ member }))
        break
      }
      case 'zset': {
        const flat = (await this.cmd(['ZRANGE', key, '0', String(n - 1), 'WITHSCORES'])) as string[]
        columns = ['member', 'score']
        for (let i = 0; i < flat.length; i += 2) rows.push({ member: flat[i], score: Number(flat[i + 1]) })
        break
      }
      case 'stream': {
        const entries = (await this.cmd(['XRANGE', key, '-', '+', 'COUNT', String(n)])) as [string, string[]][]
        columns = ['id', 'fields']
        rows = entries.map(([id, f]) => {
          const obj: Record<string, string> = {}
          for (let i = 0; i < f.length; i += 2) obj[f[i]] = f[i + 1]
          return { id, fields: obj }
        })
        break
      }
      case 'none':
        throw new Error(`Key "${key}" no longer exists`)
      default:
        columns = ['value']
        rows = [{ value: `(${type} values can't be shown yet)` }]
    }
    return { columns, rows, rowCount: rows.length, durationMs: Math.round(performance.now() - start) }
  }

  /** Run one command per line; shows the reply of the last one. */
  async query(text: string): Promise<QueryResult> {
    const start = performance.now()
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
    if (!lines.length) throw new Error('Type a Redis command, e.g. GET mykey')
    let reply: unknown
    for (const line of lines) reply = await this.cmd(splitArgs(line))
    const { columns, rows } = replyToRows(reply)
    return { columns, rows, rowCount: rows.length, durationMs: Math.round(performance.now() - start) }
  }

  async applyUpdates(updates: RowUpdate[]): Promise<number> {
    let total = 0
    for (const u of updates) {
      const key = u.table.name
      const type = await this.typeOf(key)
      const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
      const multi = this.c.multi()
      switch (type) {
        case 'string':
          if ('value' in u.changes) multi.addCommand(['SET', key, str(u.changes.value)])
          break
        case 'hash':
          if ('value' in u.changes) multi.addCommand(['HSET', key, str(u.primaryKey.field), str(u.changes.value)])
          break
        case 'list':
          if ('value' in u.changes) multi.addCommand(['LSET', key, str(u.primaryKey.index), str(u.changes.value)])
          break
        case 'zset':
          if ('score' in u.changes) multi.addCommand(['ZADD', key, str(u.changes.score), str(u.primaryKey.member)])
          break
        default:
          throw new Error(`Editing ${type} keys isn't supported; use the console instead`)
      }
      await multi.exec()
      total += 1
    }
    return total
  }
}
