import vm from 'node:vm'
import { MongoClient, Db, ObjectId, Decimal128, Long, Binary, Timestamp, Int32, Double } from 'mongodb'
import type { DbClient } from './base'
import type { ColumnInfo, ConnectionConfig, QueryResult, RowUpdate, TableInfo, IndexInfo, RowChange, TableStructure } from '../../shared/types'

const MAX_ROWS = 1000

/** Make BSON values safe to send to the UI and readable in the grid. */
function toPlain(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (v instanceof ObjectId) return `ObjectId("${v.toHexString()}")`
  if (v instanceof Date) return v
  if (v instanceof Decimal128 || v instanceof Long || v instanceof Timestamp) return v.toString()
  if (v instanceof Int32 || v instanceof Double) return v.valueOf()
  if (v instanceof Binary) return v.buffer instanceof Uint8Array ? new Uint8Array(v.buffer) : String(v)
  if (Array.isArray(v)) return v.map(toPlain)
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toPlain(x)]))
  return v
}

/** Reverse of toPlain for values coming back from the grid. */
function fromPlain(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const m = /^ObjectId\("([0-9a-f]{24})"\)$/i.exec(v)
  if (m) return new ObjectId(m[1])
  return v
}

/** Grid edits arrive as text: keep numbers/booleans/JSON as their real types. */
function parseEdited(v: unknown): unknown {
  if (v === null || typeof v !== 'string') return v
  const id = fromPlain(v)
  if (id !== v) return id
  const t = v.trim()
  if (t === 'true' || t === 'false') return t === 'true'
  if (t !== '' && !isNaN(Number(t)) && /^-?\d/.test(t)) return Number(t)
  if (/^[[{]/.test(t)) { try { return JSON.parse(t) } catch { /* keep text */ } }
  return v
}

function toResult(value: unknown, start: number): QueryResult {
  const durationMs = Math.round(performance.now() - start)
  const docs = Array.isArray(value) ? value : value === undefined ? [] : [value]
  const rows = docs.map((d) =>
    d !== null && typeof d === 'object' && !(d instanceof Date) && !(d instanceof ObjectId)
      ? (toPlain(d) as Record<string, unknown>)
      : { result: toPlain(d) }
  )
  const cols: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  // Keep _id first, like Compass and Beekeeper
  cols.sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : 0))
  return { columns: cols, rows, rowCount: rows.length, durationMs }
}

export class MongoDbClient implements DbClient {
  readonly canEdit = true
  private client?: MongoClient
  private db?: Db

  constructor(private config: ConnectionConfig) {}

  async connect() {
    const c = this.config
    let uri = c.url?.trim()
    if (!uri) {
      const auth = c.user ? `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password ?? '')}@` : ''
      uri = `mongodb://${auth}${c.host || 'localhost'}:${c.port || 27017}/${c.database ?? ''}${c.ssl ? '?tls=true' : ''}`
    }
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      ...(c.sslCa ? { tls: true, tlsCAFile: c.sslCa, tlsCertificateKeyFile: c.sslCert || undefined } : {})
    })
    await this.client.connect()
    this.db = this.client.db(c.database || undefined)
    await this.db.command({ ping: 1 })
  }

  async disconnect() { await this.client?.close() }

  private get d() {
    if (!this.db) throw new Error('Not connected')
    return this.db
  }

  async listDatabases() {
    const current = this.d.databaseName
    try {
      const r = await this.d.admin().listDatabases({ nameOnly: true })
      return { databases: r.databases.map((d) => d.name).sort(), current }
    } catch {
      // Users without listDatabases rights still see their own database
      return { databases: [current], current }
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const list = await this.d.listCollections({}, { nameOnly: false }).toArray()
    return list
      .map((c) => ({ name: c.name, type: (c.type === 'view' ? 'view' : 'table') as 'view' | 'table' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** MongoDB has no fixed schema, so sample documents to find the fields. */
  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const sample = await this.d.collection(t.name).find().limit(100).toArray()
    const types = new Map<string, Set<string>>()
    for (const doc of sample) {
      for (const [k, v] of Object.entries(doc)) {
        const ty = v === null ? 'null' : v instanceof ObjectId ? 'ObjectId' : v instanceof Date ? 'Date' : Array.isArray(v) ? 'Array' : typeof v
        if (!types.has(k)) types.set(k, new Set())
        types.get(k)!.add(ty)
      }
    }
    if (!types.has('_id')) types.set('_id', new Set(['ObjectId']))
    return [...types.entries()]
      .sort(([a], [b]) => (a === '_id' ? -1 : b === '_id' ? 1 : 0))
      .map(([name, s]) => ({ name, dataType: [...s].join(' | '), nullable: name !== '_id', primaryKey: name === '_id' }))
  }

  async selectTop(t: TableInfo, limit: number): Promise<QueryResult> {
    const start = performance.now()
    const docs = await this.d.collection(t.name).find().limit(Math.min(limit, 50000)).toArray()
    return toResult(docs, start)
  }

  /**
   * Run mongosh-style code, e.g. db.users.find({ age: { $gt: 30 } }).sort({ name: 1 })
   * `db.<name>` is a real driver collection, so its methods and cursors work as in Node.
   */
  async query(code: string): Promise<QueryResult> {
    const start = performance.now()
    const database = this.d
    const helpers: Record<string, unknown> = {
      getCollection: (n: string) => database.collection(n),
      getCollectionNames: async () => (await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
      runCommand: (cmd: object) => database.command(cmd),
      createCollection: (n: string, o?: object) => database.createCollection(n, o),
      dropDatabase: () => database.dropDatabase(),
      stats: () => database.stats()
    }
    const dbProxy = new Proxy({}, {
      get: (_t, prop) => (typeof prop === 'string' ? (prop in helpers ? helpers[prop] : database.collection(prop)) : undefined)
    })
    const context = vm.createContext({
      db: dbProxy,
      ObjectId: (id?: string) => new ObjectId(id),
      ISODate: (s?: string) => (s ? new Date(s) : new Date()),
      Date, JSON, Math, Number, String, Boolean, Array, Object, RegExp
    })
    let value = vm.runInContext(code, context, { timeout: 5000 })
    value = await value
    // Cursors (find, aggregate, listIndexes…) → fetch a bounded number of docs
    if (value && typeof (value as { toArray?: unknown }).toArray === 'function') {
      const cursor = value as { limit?: (n: number) => unknown; toArray: () => Promise<unknown[]> }
      const arr = await cursor.toArray()
      value = arr.slice(0, MAX_ROWS)
    }
    return toResult(value, start)
  }

  async applyUpdates(updates: RowUpdate[]): Promise<number> {
    let total = 0
    for (const u of updates) {
      const filter = Object.fromEntries(Object.entries(u.primaryKey).map(([k, v]) => [k, fromPlain(v)]))
      const set = Object.fromEntries(Object.entries(u.changes).map(([k, v]) => [k, parseEdited(v)]))
      if (!Object.keys(set).length) continue
      const r = await this.d.collection(u.table.name).updateOne(filter, { $set: set })
      total += r.modifiedCount
    }
    return total
  }

  async getStructure(t: TableInfo): Promise<TableStructure> {
    const columns = await this.listColumns(t)
    const ix = await this.d.collection(t.name).indexes().catch(() => [])
    const indexes: IndexInfo[] = ix.map((i: any) => ({ name: i.name, unique: !!i.unique || i.name === '_id_', primary: i.name === '_id_', columns: Object.keys(i.key ?? {}) }))
    return { columns, indexes, foreignKeys: [], triggers: [] }
  }

  async applyChanges(changes: RowChange[]): Promise<number> {
    let total = 0
    for (const ch of changes) {
      const col = this.d.collection(ch.table.name)
      if (ch.op === 'update') total += await this.applyUpdates([ch])
      else if (ch.op === 'insert') {
        const doc = Object.fromEntries(Object.entries(ch.values).filter(([k]) => k !== '_id' || ch.values[k] !== '').map(([k, v]) => [k, parseEdited(v)]))
        await col.insertOne(doc)
        total++
      } else {
        const filter = Object.fromEntries(Object.entries(ch.primaryKey).map(([k, v]) => [k, fromPlain(v)]))
        total += (await col.deleteOne(filter)).deletedCount
      }
    }
    return total
  }
}
