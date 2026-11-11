// Types shared by the Electron main process and the React UI.
import type { DbKind } from './drivers'
export type { DbKind } from './drivers'

export interface ConnectionConfig {
  kind: DbKind
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  /** File-based databases (SQLite, DuckDB) */
  file?: string
  /** URL-based databases (LibSQL / Turso) */
  url?: string
  authToken?: string
  ssl?: boolean
  /** SQL Server: accept self-signed certificates */
  trustServerCertificate?: boolean
  /** SSL certificate files (PostgreSQL, MySQL, MongoDB) */
  sslCa?: string
  sslCert?: string
  sslKey?: string
  /** SQL Server: 'ntlm' signs in with a Windows / domain account */
  authType?: 'sql' | 'ntlm'
  domain?: string
  /** Snowflake / Trino: default schema */
  schema?: string
  /** Snowflake: warehouse and role */
  warehouse?: string
  role?: string
  /** BigQuery: service-account key file (JSON) */
  keyFile?: string
  /** Cassandra: local data centre name */
  datacenter?: string
  /** DynamoDB / BigQuery: region or location */
  region?: string
  /** Reach the database through an SSH server */
  ssh?: SshConfig
  /** Internal: this connection belongs to a query tab (one connection, no pool) */
  session?: boolean
}

export interface SshConfig {
  enabled: boolean
  host: string
  port?: number
  user: string
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export interface SavedConnection {
  id: string
  name: string
  color?: string
  /** Production: red bar, confirm before any change */
  production?: boolean
  /** Read-only: block statements that change data or schema */
  readOnly?: boolean
  /** Workspace / folder the connection is listed under */
  group?: string
  config: ConnectionConfig
}

export interface TableInfo {
  schema?: string
  name: string
  type?: 'table' | 'view'
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  primaryKey: boolean
  /** Default expression as the database reports it */
  defaultValue?: string | null
  autoIncrement?: boolean
}

/** Things other than tables that a database holds; which kinds exist depends on the engine. */
export type ObjectKind =
  | 'procedure' | 'function' | 'trigger' | 'sequence' | 'event' | 'package'
  | 'matview' | 'type' | 'synonym' | 'index'

export interface DbObject {
  kind: ObjectKind
  schema?: string
  name: string
  /** Table a trigger or index belongs to */
  table?: string
  /** Engine-specific id used to fetch the definition (e.g. PostgreSQL oid) */
  id?: string
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
}

export interface ForeignKeyInfo {
  name: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
}

export interface TableStructure {
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  triggers: DbObject[]
}

/** A staged grid change: edit, new row or deleted row */
export type RowChange =
  | { op: 'update'; table: TableInfo; primaryKey: Record<string, unknown>; changes: Record<string, unknown> }
  | { op: 'insert'; table: TableInfo; values: Record<string, unknown> }
  | { op: 'delete'; table: TableInfo; primaryKey: Record<string, unknown> }

/** One page of table rows, filtered and sorted by the database */
export interface PageOptions {
  offset: number
  limit: number
  /** Raw WHERE condition typed by the user (without the word WHERE) */
  where?: string
  orderBy?: { col: string; dir: 'asc' | 'desc' }[]
}

/** Query plan: 'json' (PostgreSQL, MySQL), 'xml' (SQL Server) or plain 'text' */
export interface ExplainResult {
  format: 'json' | 'xml' | 'text'
  plan: string
}

export type TxAction = 'begin' | 'commit' | 'rollback'

/** Data read from a CSV, Excel or JSON file for import */
export interface ImportData {
  columns: string[]
  rows: Record<string, unknown>[]
}

export type ExportFormat = 'csv' | 'excel' | 'json' | 'sql' | 'markdown' | 'html'

/** A query that runs on a timer and writes its result to a file */
export interface Schedule {
  id: string
  name: string
  enabled: boolean
  /** Saved connection to run on */
  connectionId: string
  /** Database to use instead of the connection's default */
  database?: string
  sql: string
  /** 'minutes' repeats every N minutes; 'daily' / 'weekdays' run at `at` (HH:MM) */
  every: 'minutes' | 'daily' | 'weekdays'
  minutes?: number
  at?: string
  format: ExportFormat
  folder: string
  /** File name without extension (default: the schedule name) */
  fileName?: string
  /** Write the same file each time instead of adding the date and time */
  overwrite?: boolean
  maxRows?: number
  notify?: boolean
  nextRun?: number
  history?: ScheduleRun[]
}

export interface UpdateInfo { current: string; latest: string; available: boolean; download: string }
export interface LicenceInfo { valid: boolean; error?: string; name?: string; email?: string; plan?: string; seats?: number; expires?: string }
/** Shared through the team folder */
export interface TeamQuery { name: string; text: string; engine?: string; by?: string; at: number }
export interface TeamData { queries: TeamQuery[]; connections: SavedConnection[] }

export interface ScheduleRun { at: number; ok: boolean; ms: number; rows?: number; file?: string; error?: string }

export interface AiRequest {
  /** What the user typed */
  question: string
  /** 'write' turns a question into SQL; 'explain' explains the SQL; 'fix' repairs it using the error */
  mode: 'write' | 'explain' | 'fix'
  engine: string
  /** Tables and columns, as compact text */
  schema: string
  sql?: string
  error?: string
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  /** True when more rows existed than the row limit, so only the first ones were loaded */
  truncated?: boolean
}

/** One row's cell edits from the grid, applied as an UPDATE by primary key. */
export interface RowUpdate {
  table: TableInfo
  primaryKey: Record<string, unknown>
  changes: Record<string, unknown>
}

export interface ConnectInfo {
  id: string
  /** False when the database can't apply grid edits (e.g. ClickHouse) */
  canEdit: boolean
}

/** The API the preload script exposes to the UI as window.db */
export interface DbApi {
  connect(config: ConnectionConfig): Promise<ConnectInfo>
  test(config: ConnectionConfig): Promise<void>
  disconnect(id: string): Promise<void>
  /** null when the database type has no database list (e.g. SQLite) */
  listDatabases(id: string): Promise<{ databases: string[]; current: string } | null>
  switchDatabase(id: string, database: string): Promise<void>
  listTables(id: string): Promise<TableInfo[]>
  listColumns(id: string, table: TableInfo): Promise<ColumnInfo[]>
  query(id: string, sql: string): Promise<QueryResult>
  /** Run a script; one result per statement */
  /** maxRows: stop reading each result after this many rows (0 = no limit) */
  queryMulti(id: string, sql: string, maxRows?: number): Promise<QueryResult[]>
  /** Procedures, functions, triggers… (empty when the database has none) */
  listObjects(id: string): Promise<DbObject[]>
  /** CREATE script for a table, view or other object */
  getDefinition(id: string, target: DbObject | (TableInfo & { kind: 'table' | 'view' })): Promise<string>
  /** Columns with defaults, indexes, foreign keys and triggers of one table */
  getStructure(id: string, table: TableInfo): Promise<TableStructure>
  /** Insert, update and delete rows in one transaction; returns rows affected */
  applyChanges(id: string, changes: RowChange[]): Promise<number>
  /** Stop the query running on this connection */
  cancel(id: string): Promise<void>
  /** Open a separate connection for a query tab (returns its id) */
  openSession(parentId: string): Promise<string>
  closeSession(parentId: string, id: string): Promise<void>
  /** Shows a save dialog; returns the saved path, or null if cancelled */
  exportData(data: { columns: string[]; rows: Record<string, unknown>[] }, format: ExportFormat, name: string, table?: string, engine?: string): Promise<string | null>
  /** One page of a table, filtered and sorted on the server; total is the filtered row count */
  selectPage(id: string, table: TableInfo, options: PageOptions): Promise<QueryResult & { total: number | null }>
  /** Estimated plan for a query, without running it */
  explain(id: string, sql: string): Promise<ExplainResult>
  /** Begin, commit or roll back a transaction on this connection */
  transaction(id: string, action: TxAction): Promise<void>
  /** Read rows from a CSV, Excel or JSON file */
  readImportFile(file: string): Promise<ImportData>
  /** AI assistant (the API key stays in the main process) */
  aiAsk(req: AiRequest): Promise<string>
  aiHasKey(): Promise<boolean>
  aiSetKey(key: string, model: string): Promise<void>
  /** Write an error to the local log file */
  logError(text: string): Promise<void>
  openLogFolder(): Promise<void>
  selectTop(id: string, table: TableInfo, limit: number): Promise<QueryResult>
  applyUpdates(id: string, updates: RowUpdate[]): Promise<number>
  listSaved(): Promise<SavedConnection[]>
  saveConnection(conn: SavedConnection): Promise<SavedConnection[]>
  deleteSaved(id: string): Promise<SavedConnection[]>
  /** 'db' shows database files first; 'any' is any file (keys, certificates); 'data' is CSV/Excel/JSON */
  pickFile(kind?: 'db' | 'any' | 'data'): Promise<string | null>
  /** Save text to a file the user picks; returns the path, or null if cancelled. Pass path to overwrite without asking. */
  saveTextFile(content: string, opts: { name: string; filter: string; ext: string; path?: string }): Promise<string | null>
  listSchedules(): Promise<Schedule[]>
  saveSchedule(s: Schedule): Promise<Schedule[]>
  deleteSchedule(id: string): Promise<Schedule[]>
  runSchedule(id: string): Promise<ScheduleRun>
  /** Show a schedule's last file in Explorer */
  revealScheduleFile(id: string): Promise<void>
  /** Called when schedules change (a run finished); returns a function that stops listening */
  onSchedulesChanged(fn: () => void): () => void
  pickFolder(): Promise<string | null>
  appVersion(): Promise<string>
  checkForUpdate(url: string): Promise<UpdateInfo>
  getLicence(): Promise<LicenceInfo>
  setLicence(key: string): Promise<LicenceInfo>
  clearLicence(): Promise<void>
  readTeam(folder: string): Promise<TeamData>
  shareToTeam(folder: string, data: Partial<TeamData>): Promise<TeamData>
  /** Open a text file the user picks */
  openTextFile(opts: { filter: string; ext: string }): Promise<{ path: string; content: string } | null>
}
