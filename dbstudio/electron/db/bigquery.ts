import type { BigQuery, Job } from '@google-cloud/bigquery'
import { BaseClient, RunResult } from './base'
import { plain, splitStatements } from './split'
import type { ColumnInfo, ConnectionConfig, ExplainResult, TableInfo } from '../../shared/types'

/**
 * Google BigQuery. Project from the settings (or the key file), a service-account
 * key file, and optionally a default dataset (shown as the "database").
 * Read-only in the grid: BigQuery tables have no enforced primary keys.
 */
export class BigQueryClient extends BaseClient {
  readonly canEdit = false
  protected readonly engine = 'bigquery'
  protected txSql = null
  private bq?: BigQuery
  private job?: Job

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BigQuery } = require('@google-cloud/bigquery') as typeof import('@google-cloud/bigquery')
    this.bq = new BigQuery({
      projectId: this.config.host || undefined,
      keyFilename: this.config.keyFile || undefined,
      location: this.config.region || undefined
    })
    // Checks the credentials and the project
    await this.bq.getDatasets({ maxResults: 1 })
  }
  async disconnect() { this.bq = undefined }

  private get c() { if (!this.bq) throw new Error('Not connected'); return this.bq }

  protected quoteIdent(name: string) { return `\`${name.replace(/`/g, '\\`')}\`` }
  protected placeholder() { return '?' }

  private options(query: string, params: unknown[]) {
    const ds = this.config.database
    return {
      query,
      params: params.length ? params : undefined,
      location: this.config.region || undefined,
      defaultDataset: ds ? { datasetId: ds, projectId: this.c.projectId } : undefined
    }
  }

  protected async run(sql: string, params: unknown[] = [], maxRows = 50000): Promise<RunResult> {
    const [job] = await this.c.createQueryJob(this.options(sql, params))
    this.job = job
    try {
      const [rows, , resp] = await job.getQueryResults({ autoPaginate: false, maxResults: maxRows || 50000 })
      const r = resp as { schema?: { fields?: { name: string }[] }; numDmlAffectedRows?: string; totalRows?: string } | undefined
      const columns = r?.schema?.fields?.map((f) => f.name) ?? (rows[0] ? Object.keys(rows[0]) : [])
      const data = rows.map((x: Record<string, unknown>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)])))
      const isDml = r?.numDmlAffectedRows !== undefined
      return { columns: isDml ? [] : columns, rows: isDml ? [] : data, affected: Number(r?.numDmlAffectedRows ?? 0), truncated: Number(r?.totalRows ?? 0) > data.length }
    } finally { this.job = undefined }
  }

  protected async runMulti(sql: string, maxRows = 0): Promise<RunResult[]> {
    const out: RunResult[] = []
    for (const s of splitStatements(sql)) out.push(await this.run(s, [], maxRows))
    return out
  }

  async cancel() { await this.job?.cancel() }
  protected async transaction<T>(fn: () => Promise<T>) { return fn() }

  /** Datasets act as databases */
  async listDatabases() {
    const [ds] = await this.c.getDatasets()
    return { databases: ds.map((d) => d.id!).filter(Boolean), current: this.config.database ?? '' }
  }

  async listTables(): Promise<TableInfo[]> {
    const [all] = await this.c.getDatasets()
    const pick = this.config.database ? all.filter((d) => d.id === this.config.database) : all
    const out: TableInfo[] = []
    for (const d of pick.slice(0, 50)) {
      const [tables] = await d.getTables({ maxResults: 1000 })
      for (const t of tables) out.push({ schema: d.id!, name: t.id!, type: /VIEW/.test(String(t.metadata?.type)) ? 'view' : 'table' })
    }
    return out
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    if (!t.schema) throw new Error('BigQuery tables need a dataset')
    const [meta] = await this.c.dataset(t.schema).table(t.name).getMetadata()
    const fields = (meta.schema?.fields ?? []) as { name: string; type: string; mode?: string }[]
    return fields.map((f) => ({ name: f.name, dataType: f.mode === 'REPEATED' ? `ARRAY<${f.type}>` : f.type, nullable: f.mode !== 'REQUIRED', primaryKey: false }))
  }

  /** BigQuery has no plan before running; a dry run says how much data the query would read. */
  async explain(sql: string): Promise<ExplainResult> {
    const [job] = await this.c.createQueryJob({ ...this.options(sql.trim().replace(/;+\s*$/, ''), []), dryRun: true })
    const bytes = Number(job.metadata?.statistics?.totalBytesProcessed ?? 0)
    const size = bytes > 1e12 ? `${(bytes / 1e12).toFixed(2)} TB` : bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`
    const tables = (job.metadata?.statistics?.query?.referencedTables ?? []) as { datasetId: string; tableId: string }[]
    return { format: 'text', plan: `Dry run (nothing was run)\n\nThis query will read ${size}.\n${tables.length ? `\nTables read:\n${tables.map((x) => `  ${x.datasetId}.${x.tableId}`).join('\n')}` : ''}` }
  }
}
